/**
 * SO User Service
 *
 * Officer-facing management of sending-organisation accounts, plus the SOUSER's
 * own self-service profile edits.
 *
 * Two rules run through everything here:
 *
 *   1. Every officer action resolves its target through assertManageable(),
 *      which requires the account's primary_bu to be the officer's own BU. The
 *      routes take a bare :id, so without this an officer could manage accounts
 *      in a BU they have no relationship with.
 *
 *   2. Postgres is committed before Stream and email are touched, and neither
 *      of those can roll the account back. A half-created account — a row with
 *      no Stream user, or a Stream user with no row — is worse than a created
 *      account whose chat metadata the nightly reconcile will repair. Failures
 *      come back as `warnings` so the officer sees what did not happen.
 */
import crypto from "crypto";
import bcrypt from "bcrypt";
import { StreamChat } from "stream-chat";
import * as souserRepo from "../repositories/souserRepository.js";
import { ConflictError, NotFoundError } from "../errors/AppError.js";
import * as mailer from "../config/systemMailer.js";
import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import { revokeStreamAccess, restoreStreamAccess, pruneOutOfScopeChannels } from "./chatAccessService.js";

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

// ── Stream projection ─────────────────────────────────────────────────────────

/**
 * Pushes the SOUSER's authorisation scope onto their Stream user record.
 *
 * sending_org and bu_access are what client-side channel and user queries filter
 * on, and what a Stream permission rule would key on. They are attributes of the
 * account, so every path that changes a grant re-pushes them — a stale bu_access
 * on Stream is a user still discoverable in a BU they were revoked from.
 *
 * Partial update, never a full upsert: upsertUser replaces the whole object and
 * would drop attributes this function does not know about.
 */
const syncScopeToStream = async (souserId) => {
  const { rows } = await souserRepo.findActiveBuList(souserId);
  const { rows: [record] } = await souserRepo.findById(souserId);
  await streamClient.partialUpdateUser({
    id: String(souserId),
    set: {
      user_type: "souser",
      bu_access: rows.map((r) => r.business_unit),
      ...(record?.sending_org ? { sending_org: record.sending_org } : {}),
    },
  });
};

/** Runs a best-effort side effect, collecting a warning instead of throwing. */
const bestEffort = async (warnings, label, fn) => {
  try {
    await fn();
    return true;
  } catch (err) {
    console.error(`souserService: ${label} failed`, err);
    warnings.push({ step: label, message: err?.message ?? String(err) });
    return false;
  }
};

// ── Management guard ──────────────────────────────────────────────────────────

/**
 * Resolves a souser the officer is actually allowed to manage.
 * Throws NotFoundError (not Forbidden) so an officer cannot probe for the
 * existence of accounts in other BUs.
 */
const assertManageable = async (id, officer, client) => {
  const { rows } = await souserRepo.findByIdInBU(id, officer.business_unit, client);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

// ── Read ──────────────────────────────────────────────────────────────────────

export const getSousers = async (businessUnit) => {
  const { rows } = await souserRepo.findAllByBU(businessUnit);
  return rows;
};

/** Unscoped read — only for the account's own /souser/me. */
export const getSouserById = async (id) => {
  const { rows } = await souserRepo.findById(id);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  return rows[0];
};

/** Officer-facing read, scoped to the officer's BU. */
export const getSouserForOfficer = async (id, officer) => {
  await assertManageable(id, officer);
  return getSouserById(id);
};

// ── Create ────────────────────────────────────────────────────────────────────

export const createSouser = async (data, officer) => {
  const warnings = [];

  // Guard: email must be unique
  const existing = await souserRepo.countByEmail(data.email);
  if (parseInt(existing.rows[0].count, 10) > 0) {
    throw new ConflictError("souser_email_exists");
  }

  const tempPassword = crypto.randomBytes(4).toString("hex");
  const passwordHash = await bcrypt.hash(tempPassword, 10);

  // The account row, the profile, the BU grants and the credential are one
  // unit. Previously each ran on its own connection, so a failure partway
  // through left an account that could not log in, or a souser row with no BU
  // access — and nothing cleaned either up.
  const client = await getPool().connect();
  let souserId;
  try {
    await client.query("BEGIN");

    const { rows: [account] } = await souserRepo.insertUserAccount(
      data.email, officer.business_unit, client,
    );
    souserId = account.id;

    await souserRepo.insertSouser({
      id:                 souserId,
      sending_org:        data.sending_org,
      first_name:         data.first_name,
      last_name:          data.last_name,
      display_name:       data.display_name,
      country:            data.country,
      position_title:     data.position_title,
      primary_bu:         officer.business_unit,
      created_by_officer: officer.id,
    }, client);

    // "Allow bulletin writing" defaults to off on every grant, including the
    // primary BU. An officer turns it on deliberately after creation.
    const announcementsWrite = data.announcements_write === true;

    const buCodes = [...new Set([officer.business_unit, ...(data.additional_bus || [])])];
    for (const bu of buCodes) {
      await souserRepo.insertBuAccess(souserId, bu, officer.id, announcementsWrite, client);
      await souserRepo.updateBuAccessPermissions(souserId, bu,
        data.announcements_read === true || announcementsWrite, announcementsWrite, client);
    }

    await souserRepo.setPasswordHash(souserId, passwordHash, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Everything past this point is outside the transaction and must not undo it.
  await bestEffort(warnings, "stream_upsert", async () => {
    const { rows: buRows } = await souserRepo.findActiveBuList(souserId);
    await streamClient.upsertUser({
      id:            String(souserId),
      name:          `${data.first_name} ${data.last_name}`.trim(),
      email:         data.email.toLowerCase().trim(),
      business_unit: officer.business_unit,
      sending_org:   data.sending_org,
      user_type:     "souser",
      bu_access:     buRows.map((r) => r.business_unit),
    });
  });

  // The temporary password only exists in this email. If it does not go out the
  // officer has to know, so it is reported rather than logged and swallowed.
  await bestEffort(warnings, "activation_email", () =>
    mailer.souserActivation(
      data.email,
      "Your Sending Organisation User Account",
      `${data.first_name} ${data.last_name}`,
      tempPassword,
      env.app.frontendUrl,
    ),
  );

  return { record: await getSouserById(souserId), warnings };
};

// ── Update ────────────────────────────────────────────────────────────────────

export const updateSouser = async (id, data, officer) => {
  await assertManageable(id, officer);
  const { rows } = await souserRepo.updateSouserById(id, data);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  const updated = rows[0];
  try {
    await streamClient.partialUpdateUser({
      id: String(id),
      set: {
        name: updated.display_name || `${updated.first_name} ${updated.last_name}`.trim(),
      },
    });
  } catch (streamErr) {
    console.error("souserService.updateSouser: Stream update failed", streamErr);
  }
  return updated;
};

// ── Activation ────────────────────────────────────────────────────────────────

/**
 * Activate or deactivate an SO user.
 *
 * Writes v4.user_account_tbl.is_active — the column login and auth actually
 * enforce — as well as v4.souser_tbl.is_active, then closes off Stream so the
 * deactivation reaches chat and not just the API. An already-issued Stream token
 * outlives the toggle otherwise: it is signed, not looked up, so revoking it is
 * the only way to stop it.
 *
 * @param {boolean} [isActive] - target state. Omitted = flip the current one.
 */
export const setSouserActive = async (id, isActive, officer) => {
  const target = await assertManageable(id, officer);
  const next = typeof isActive === "boolean" ? isActive : !target.account_is_active;

  const { rows } = await souserRepo.setActive(id, next, officer.id);
  if (!rows[0]) throw new NotFoundError("souser_not_found");

  const warnings = [];
  await bestEffort(warnings, next ? "stream_reactivate" : "stream_deactivate", () =>
    next ? restoreStreamAccess(id) : revokeStreamAccess(id),
  );

  return { ...rows[0], is_active: next, warnings };
};

// ── BU access ─────────────────────────────────────────────────────────────────

export const grantBuAccess = async (souserId, businessUnit, officer) => {
  await assertManageable(souserId, officer);
  if (!businessUnit) throw new NotFoundError("souser_bu_required");

  // A newly granted BU inherits the account-level "Allow bulletin writing"
  // setting, so the control means the same thing across every BU the account
  // holds instead of silently defaulting the new one to off.
  const writeEnabled = await souserRepo.isAnnouncementsWriteEnabled(souserId);
  await souserRepo.insertBuAccess(souserId, businessUnit, officer.id, writeEnabled);

  const warnings = [];
  await bestEffort(warnings, "stream_scope_sync", () => syncScopeToStream(souserId));
  return { warnings };
};

export const revokeBuAccess = async (souserId, businessUnit, officer) => {
  await assertManageable(souserId, officer);
  await souserRepo.revokeBuAccess(souserId, businessUnit, officer.id);

  const warnings = [];
  await bestEffort(warnings, "stream_scope_sync", () => syncScopeToStream(souserId));
  // Revoking a BU has to reach channels the account is already a member of —
  // Stream membership survives an attribute change, so without this the account
  // keeps reading and posting in the BU it just lost.
  await bestEffort(warnings, "stream_channel_prune", () => pruneOutOfScopeChannels(souserId));
  return { warnings };
};

// ── Delete ────────────────────────────────────────────────────────────────────

export const deleteSouser = async (id, officer) => {
  await assertManageable(id, officer);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await souserRepo.deleteSouser(id, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Stream is cleaned up after the rows are gone. If this fails the account is
  // deleted in Postgres and orphaned in Stream, which the reconcile script
  // surfaces — the reverse order would leave a live account with no chat user.
  const warnings = [];
  await bestEffort(warnings, "stream_delete", () =>
    streamClient.deleteUser(String(id), { mark_messages_deleted: false, hard: false }),
  );
  return { warnings };
};

// ── Permissions ───────────────────────────────────────────────────────────────

/**
 * The account-level "Allow bulletin writing" control.
 *
 * Applies to every BU the account currently holds. Turning it off blocks future
 * create/edit/delete only — existing bulletins and all reading access are
 * untouched, which is why this writes a permission flag and never touches
 * v4.announcement_tbl.
 */
export const setAnnouncementsWrite = async (souserId, enabled, officer) => {
  await assertManageable(souserId, officer);
  const { rows } = await souserRepo.setAnnouncementsWriteForAccount(souserId, enabled === true);
  return {
    announcements_write: enabled === true,
    business_units: rows.map((r) => r.business_unit),
  };
};

/** Per-BU permission edit, kept for the BU-level controls in SO User Management. */
export const updateBuAccessPermissions = async (souserId, businessUnit, announcements_read, announcements_write, officer) => {
  await assertManageable(souserId, officer);
  await souserRepo.updateBuAccessPermissions(souserId, businessUnit, announcements_read, announcements_write);
};

// ── Password ──────────────────────────────────────────────────────────────────

export const resetSouserPassword = async (id, newPassword, officer) => {
  await assertManageable(id, officer);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await souserRepo.updatePasswordHash(id, passwordHash);
};

// ── Self-service ──────────────────────────────────────────────────────────────

export const updateSouserSelf = async (id, data) => {
  const { rows } = await souserRepo.updateSouserById(id, data);
  if (!rows[0]) throw new NotFoundError("souser_not_found");
  const updated = rows[0];
  try {
    await streamClient.partialUpdateUser({
      id: String(id),
      set: {
        name: updated.display_name || `${updated.first_name} ${updated.last_name}`.trim(),
      },
    });
  } catch (streamErr) {
    console.error("souserService.updateSouserSelf: Stream update failed", streamErr);
  }
  return updated;
};
