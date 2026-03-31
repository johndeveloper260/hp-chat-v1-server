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
import { createNotification } from "./notificationService.js";
import { findCoordinatorsByCompany } from "../repositories/notificationRepository.js";

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

  const row = await repo.createReturnHome({
    ...body,
    targetUserId,
    creatorId,
    businessUnit,
  });

  // Notify: the application's user + company coordinators, excluding creator
  const userCompany = await repo.findUserCompany(targetUserId);
  const coordinatorIds = await findCoordinatorsByCompany(userCompany, businessUnit);
  const recipients = [...new Set([targetUserId, ...coordinatorIds])].filter(
    (id) => id && id !== creatorId,
  );

  if (recipients.length > 0) {
    const creatorName = await repo.findUserName(creatorId);
    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "new_return_home",
          bodyKey: "return_home_submitted",
          bodyParams: { name: creatorName },
          data: {
            type: "return_home",
            rowId: row.id,
            screen: "ReturnHome",
            params: { id: row.id },
          },
        }),
      ),
    );
  }

  return row;
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

  // Capture old status before overwriting — used to detect status-change events
  const oldRecord = await repo.findReturnHomeForNotify(id, businessUnit);

  const row = await repo.updateReturnHome(
    id,
    businessUnit,
    { ...body, updatedBy },
    safeUserId,
  );
  if (!row) throw new NotFoundError("record_not_found");

  // Notify: record's user + company coordinators, excluding the updater
  const applicationUserId = row.user_id;
  const userCompany = await repo.findUserCompany(applicationUserId);
  const coordinatorIds = await findCoordinatorsByCompany(userCompany, businessUnit);
  const recipients = [...new Set([applicationUserId, ...coordinatorIds])].filter(
    (uid) => uid && uid !== updatedBy,
  );

  if (recipients.length > 0) {
    const updaterName  = await repo.findUserName(updatedBy);
    const statusChanged = body.status && oldRecord && body.status !== oldRecord.status;

    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "return_home_updated",
          bodyKey: statusChanged ? "return_home_status_changed" : "return_home_application_updated",
          bodyParams: statusChanged
            ? { name: updaterName, status: body.status }
            : { name: updaterName },
          data: {
            type: "return_home",
            rowId: Number(id),
            screen: "ReturnHome",
            params: { id: Number(id) },
          },
        }),
      ),
    );
  }

  return row;
};

// ── Patch status only (user-initiated: retract → Draft, re-submit → Pending) ──

export const patchReturnHomeStatus = async (id, body, user) => {
  const { status } = body;
  const record = await repo.patchReturnHomeStatus(
    id, user.business_unit, status, user.id,
  );
  if (!record) throw new NotFoundError("record_not_found");

  // Notify: record's user + company coordinators, excluding the actor
  const userCompany = await repo.findUserCompany(record.user_id);
  const coordinatorIds = await findCoordinatorsByCompany(userCompany, user.business_unit);
  const recipients = [...new Set([record.user_id, ...coordinatorIds])].filter(
    (uid) => uid && uid !== user.id,
  );

  if (recipients.length > 0) {
    const userName = await repo.findUserName(user.id);
    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "return_home_updated",
          bodyKey: "return_home_status_changed",
          bodyParams: { name: userName, status },
          data: {
            type: "return_home",
            rowId: Number(id),
            screen: "ReturnHome",
            params: { id: Number(id) },
          },
        }),
      ),
    );
  }

  return record;
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
  const record = await repo.approveReturnHome(
    id, officer.business_unit, status, approver_remarks, officer.id,
  );

  if (record) {
    const { user_id: applicationUserId } = record;
    const userCompany = await repo.findUserCompany(applicationUserId);
    const coordinatorIds = await findCoordinatorsByCompany(userCompany, officer.business_unit);
    const recipients = [...new Set([applicationUserId, ...coordinatorIds])].filter(
      (uid) => uid && uid !== officer.id,
    );

    if (recipients.length > 0) {
      const officerName = await repo.findUserName(officer.id);
      await Promise.all(
        recipients.map((recipientId) =>
          createNotification({
            userId: recipientId,
            titleKey: "return_home_updated",
            bodyKey: "return_home_status_changed",
            bodyParams: { name: officerName, status },
            data: {
              type: "return_home",
              rowId: Number(id),
              screen: "ReturnHome",
              params: { id: Number(id) },
            },
          }),
        ),
      );
    }
  }
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
