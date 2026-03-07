/**
 * Return Home Service
 *
 * Business logic for return_home_tbl records.
 * Resolves the cross-controller dependency on attachmentController by
 * importing deleteFromS3 from the shared s3Client utility instead.
 */
import * as repo             from "../repositories/returnHomeRepository.js";
import { deleteFromS3 }       from "../utils/s3Client.js";
import { getPool }            from "../config/getPool.js";
import { ForbiddenError, NotFoundError } from "../errors/AppError.js";

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Search ────────────────────────────────────────────────────────────────────

export const searchReturnHome = async (requestor, filters) => {
  const userRole = requestor.userType?.toUpperCase() || "";
  const lang     = requestor.preferred_language || "en";
  return repo.searchReturnHome(
    requestor.business_unit,
    requestor.id,
    userRole,
    lang,
    filters,
  );
};

// ── Create ────────────────────────────────────────────────────────────────────

export const createReturnHome = async (body, creatorId, businessUnit) => {
  const targetUserId =
    body.user_id && UUID_RE.test(body.user_id) ? body.user_id : creatorId;

  return repo.createReturnHome({
    ...body,
    targetUserId,
    creatorId,
    businessUnit,
  });
};

// ── Get by ID ─────────────────────────────────────────────────────────────────

export const getReturnHomeById = async (id, businessUnit, lang) => {
  const record = await repo.findReturnHomeById(id, businessUnit, lang);
  if (!record) {
    throw new NotFoundError(
      "record_not_found",
      "api_errors.return_home.record_not_found",
    );
  }
  const attachments = await repo.findAttachments(id, businessUnit);
  return { ...record, attachments };
};

// ── Update ────────────────────────────────────────────────────────────────────

export const updateReturnHome = async (id, body, updatedBy, businessUnit) => {
  const safeUserId =
    body.user_id && UUID_RE.test(String(body.user_id).trim())
      ? String(body.user_id).trim()
      : null;

  console.log("[updateReturnHome] user_id from body:", JSON.stringify(body.user_id), "-> safeUserId:", safeUserId);

  const row = await repo.updateReturnHome(
    id,
    businessUnit,
    { ...body, updatedBy },
    safeUserId,
  );
  if (!row) throw new NotFoundError("record_not_found");
  return row;
};

// ── Approve ───────────────────────────────────────────────────────────────────

export const approveReturnHome = async (id, body, officer) => {
  const userRole = officer.userType?.toUpperCase() || "";
  if (!ELEVATED_ROLES.includes(userRole)) {
    throw new ForbiddenError(
      "officer_only_approve",
      "api_errors.return_home.officer_only_approve",
    );
  }
  const { status, approver_remarks } = body;
  await repo.approveReturnHome(id, officer.business_unit, status, approver_remarks, officer.id);
};

// ── Delete ────────────────────────────────────────────────────────────────────

export const deleteReturnHome = async (id, businessUnit) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const exists = await repo.checkExistsForDelete(id, businessUnit, client);
    if (!exists) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }

    // Collect S3 keys before deleting DB rows
    const attachRows = await repo.findAttachmentKeys(id, businessUnit, client);

    // Delete from S3 first (best-effort; DB rows cleaned up regardless)
    for (const row of attachRows) {
      try {
        await deleteFromS3(row.s3_key, row.s3_bucket);
      } catch (s3Err) {
        console.error(`S3 delete failed for key ${row.s3_key}:`, s3Err);
      }
    }

    // Cascade delete related rows, then the parent record
    await repo.deleteRelated(id, businessUnit, client);
    await repo.deleteRecord(id, businessUnit, client);

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};
