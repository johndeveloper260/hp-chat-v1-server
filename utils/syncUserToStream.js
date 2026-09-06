import { StreamChat } from "stream-chat";

import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import {
  PROJECT_ONE_SQL,
  PROJECT_BY_COMPANY_SQL,
  PROJECT_BY_VISA_TYPE_SQL,
  buildCreatePayload,
  buildUpdatePayload,
} from "./streamUserProjection.js";

/** Stream recommended max per partialUpdateUsers call. */
const BATCH_SIZE = 100;

let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) {
    _streamChat = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamChat;
};

/** Runs the projection for one user. Returns null when the user has no profile row. */
const projectUser = async (userId, dbClient) => {
  const runner = dbClient || getPool();
  const { rows } = await runner.query(PROJECT_ONE_SQL, [userId]);
  return rows[0] ?? null;
};

/**
 * Writes projected rows to Stream in batches.
 *
 * Shared by the nightly job and every fan-out below, so they cannot drift apart in
 * batching or error handling.
 *
 * @param   {object[]} rows - rows from any projection query
 * @param   {string}   label - log prefix, e.g. "[StreamSync]"
 * @returns {{ synced: number, skipped: number, errors: number }}
 */
export const pushUpdates = async (rows, label = "[StreamSync]") => {
  const streamChat = getStreamChat();
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const payloads = rows
      .slice(i, i + BATCH_SIZE)
      .map((row) => {
        const payload = buildUpdatePayload(row);
        if (!payload) skipped++;
        return payload;
      })
      .filter(Boolean);

    if (!payloads.length) continue;

    const batchNo = Math.floor(i / BATCH_SIZE) + 1;

    try {
      await streamChat.partialUpdateUsers(payloads);
      synced += payloads.length;
      console.log(`${label} Batch ${batchNo}: updated ${payloads.length} users.`);
    } catch (err) {
      // A partial update targets an existing Stream user — unlike the upsert this
      // replaced, it will not conjure one. A single unknown id (a user who never
      // completed registration) can therefore reject the whole call, so fall back to
      // one-at-a-time and lose only the rows that are genuinely bad.
      console.error(
        `${label} Batch ${batchNo} failed (${err.message}) — retrying individually.`,
      );

      for (const payload of payloads) {
        try {
          await streamChat.partialUpdateUser(payload);
          synced++;
        } catch (userErr) {
          errors++;
          console.error(`${label}   user ${payload.id}: ${userErr.message}`);
        }
      }
    }
  }

  return { synced, skipped, errors };
};

/**
 * Reconcile a user's Stream attributes from Postgres.
 *
 * Partial update: fields Postgres owns are set or unset, everything else on the
 * Stream record is left alone. business_unit is not touched — it is written once
 * by createStreamUser() at registration and never again.
 *
 * No-ops for accounts with no v4.user_profile_tbl row (sousers), whose Stream
 * metadata is owned by souserService.
 *
 * @param {string} userId - The user's UUID
 * @param {import('pg').PoolClient} [dbClient] - Optional pg client (use inside a transaction)
 */
export const syncUserToStream = async (userId, dbClient) => {
  const row = await projectUser(userId, dbClient);

  if (!row) {
    console.warn(`syncUserToStream: no profile row for id ${userId} — skipped`);
    return;
  }

  const payload = buildUpdatePayload(row);
  if (!payload) return;

  await getStreamChat().partialUpdateUser(payload);
};

/**
 * Create the Stream user for a newly registered account.
 *
 * The only path that writes business_unit, and the only one that may use a full
 * upsert — there is no existing Stream record whose attributes could be lost.
 *
 * @param {string} userId - The user's UUID
 * @param {import('pg').PoolClient} [dbClient] - Optional pg client (use inside a transaction)
 */
export const createStreamUser = async (userId, dbClient) => {
  const row = await projectUser(userId, dbClient);

  if (!row) {
    console.warn(`createStreamUser: no profile row for id ${userId} — skipped`);
    return;
  }

  await getStreamChat().upsertUser(buildCreatePayload(row));
};

// ── Fan-outs ──────────────────────────────────────────────────────────────────
//
// company_name and visa_type_descr are denormalized into every member's Stream
// record, so renaming the company or editing the visa description leaves every one
// of them stale. These re-project the affected users.
//
// Both are best-effort by design: a rename can touch hundreds of users and must not
// block or fail the officer's request. A failure is logged and left for the nightly
// reconcile, matching how profileService already treats Stream sync.

/**
 * Re-syncs everyone in a company. Call after the company's name changes.
 * @param {string} companyId
 * @param {string} businessUnit
 */
export const syncCompanyMembersToStream = async (companyId, businessUnit) => {
  const { rows } = await getPool().query(PROJECT_BY_COMPANY_SQL, [
    String(companyId),
    businessUnit,
  ]);
  if (!rows.length) return { synced: 0, skipped: 0, errors: 0 };

  console.log(`[StreamFanout] Company ${companyId}: re-syncing ${rows.length} users.`);
  return pushUpdates(rows, "[StreamFanout]");
};

/**
 * Re-syncs everyone on a visa code. Call after the code's description changes.
 * @param {string} visaCode
 * @param {string} businessUnit
 */
export const syncVisaTypeMembersToStream = async (visaCode, businessUnit) => {
  const { rows } = await getPool().query(PROJECT_BY_VISA_TYPE_SQL, [
    visaCode,
    businessUnit,
  ]);
  if (!rows.length) return { synced: 0, skipped: 0, errors: 0 };

  console.log(`[StreamFanout] Visa ${visaCode}: re-syncing ${rows.length} users.`);
  return pushUpdates(rows, "[StreamFanout]");
};
