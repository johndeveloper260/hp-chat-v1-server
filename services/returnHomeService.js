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
import { ConflictError, ForbiddenError, NotFoundError } from "../errors/AppError.js";
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
    const updaterName = await repo.findUserName(updatedBy);

    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "return_home_updated",
          bodyKey: "return_home_application_updated",
          bodyParams: { name: updaterName },
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

  if (!record) {
    const current = await repo.findReturnHomeForNotify(id, officer.business_unit);
    if (!current) {
      throw new NotFoundError(
        "record_not_found",
        "api_errors.return_home.record_not_found",
      );
    }
    throw new ConflictError(
      "return_home_invalid_approval_transition",
      "api_errors.return_home.invalid_approval_transition",
      { status: current.status },
    );
  }

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
  return record;
};

// ── Cancel an approved application ──────────────────────────────────────────

export const cancelApprovedReturnHome = async (id, body, approver) => {
  const userRole = approver.userType?.toUpperCase() || "";
  if (!ELEVATED_ROLES.includes(userRole)) {
    throw new ForbiddenError(
      "officer_only_approve",
      "api_errors.return_home.officer_only_approve",
    );
  }

  const record = await repo.cancelApprovedReturnHome(
    id,
    approver.business_unit,
    body.cancellation_reason,
    approver.id,
  );

  if (!record) {
    const current = await repo.findReturnHomeForNotify(id, approver.business_unit);
    if (!current) {
      throw new NotFoundError(
        "record_not_found",
        "api_errors.return_home.record_not_found",
      );
    }
    throw new ConflictError(
      "return_home_invalid_cancellation_transition",
      "api_errors.return_home.invalid_cancellation_transition",
      { status: current.status },
    );
  }

  const userCompany = await repo.findUserCompany(record.user_id);
  const coordinatorIds = await findCoordinatorsByCompany(
    userCompany,
    approver.business_unit,
  );
  const recipients = [...new Set([record.user_id, ...coordinatorIds])].filter(
    (uid) => uid && uid !== approver.id,
  );

  if (recipients.length > 0) {
    const approverName = await repo.findUserName(approver.id);
    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "return_home_updated",
          bodyKey: "return_home_status_changed",
          bodyParams: { name: approverName, status: "Cancelled" },
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

// ── Delete ────────────────────────────────────────────────────────────────────

export const deleteReturnHome = async (id, businessUnit) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const record = await repo.findReturnHomeForDelete(id, businessUnit, client);
    if (!record) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }
    if (["Approved", "Cancelled"].includes(record.status)) {
      await client.query("ROLLBACK");
      throw new ConflictError(
        "return_home_finalized_cannot_delete",
        "api_errors.return_home.finalized_cannot_delete",
      );
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
