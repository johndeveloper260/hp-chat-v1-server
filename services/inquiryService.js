/**
 * Inquiry Service
 *
 * Business logic for v4.inquiry_tbl:
 *   searchInquiries, createInquiry, updateInquiry, deleteInquiry,
 *   getIssues, getOfficersByBU
 *
 * Cross-service dependencies:
 *   - createNotification  → notificationService
 *   - deleteFromS3        → utils/s3Client  (replaces the old attachmentController import)
 */
import { getPool }           from "../config/getPool.js";
import { getUserLanguage }   from "../utils/getUserLanguage.js";
import { deleteFromS3 }      from "../utils/s3Client.js";
import { createNotification } from "./notificationService.js";
import * as inquiryRepo      from "../repositories/inquiryRepository.js";
import { NotFoundError, ValidationError } from "../errors/AppError.js";

// ─── 1. Search ────────────────────────────────────────────────────────────────

export const searchInquiries = async ({ query: filters, userId, businessUnit, userRole }) => {
  const lang = filters.lang || await getUserLanguage(userId);
  return inquiryRepo.searchInquiries({ lang, businessUnit, userId, userRole, filters });
};

// ─── 2. Create ────────────────────────────────────────────────────────────────

export const createInquiry = async ({ body, userId, userBU }) => {
  const {
    company, title, description, occur_date, type,
    high_pri, watcher, owner_id, opened_by, assigned_to,
  } = body;

  const newInquiry = await inquiryRepo.insertInquiry({
    userBU, company, title, description, occur_date,
    type, high_pri, watcher,
    opened_by: opened_by || userId,
    owner_id: owner_id || userId,
    assigned_to: assigned_to || null,
  });

  // Fan-out notifications to owner, assignee, and watchers (excluding creator)
  const recipients = [owner_id, assigned_to, ...(Array.isArray(watcher) ? watcher : [])];
  const notifyIds = [...new Set(recipients)].filter((id) => id && id !== userId);

  if (notifyIds.length > 0) {
    const creatorName = await inquiryRepo.findUserName(userId);
    const titleKey = high_pri ? "new_inquiry_high_priority" : "new_inquiry";

    await Promise.all(
      notifyIds.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey,
          bodyKey: "created_inquiry",
          bodyParams: { name: creatorName, title },
          data: {
            type: "inquiries",
            rowId: newInquiry.ticket_id,
            screen: "Inquiry",
            params: { ticketId: newInquiry.ticket_id },
          },
        }),
      ),
    );
  }

  return newInquiry;
};

// ─── 3. Update ────────────────────────────────────────────────────────────────

export const updateInquiry = async ({ ticketId, body, userId, userBU }) => {
  const {
    status, assigned_to, resolution, description,
    high_pri, watcher, closed_dt, title, type, occur_date,
  } = body;

  const [oldInquiry] = await Promise.all([
    inquiryRepo.findOldInquiry(ticketId, userBU),
  ]);

  const updated = await inquiryRepo.updateInquiry({
    status, assigned_to, resolution, description, high_pri,
    watcher, closed_dt, userId, ticketId, title, type,
    occur_date, userBU,
  });
  if (!updated) throw new NotFoundError("record_not_found");

  // Build recipient set: owner, assignee, watchers (excluding the updater)
  const recipientsSet = new Set();
  if (updated.owner_id && updated.owner_id !== userId)     recipientsSet.add(updated.owner_id);
  if (updated.assigned_to && updated.assigned_to !== userId) recipientsSet.add(updated.assigned_to);
  if (watcher && Array.isArray(watcher)) {
    watcher.forEach((w) => { if (w && w !== userId) recipientsSet.add(w); });
  }

  const recipients = Array.from(recipientsSet);
  if (recipients.length > 0) {
    const updaterName = await inquiryRepo.findUserName(userId);
    let bodyKey;
    let bodyParams = { name: updaterName };

    if (status && oldInquiry && status !== oldInquiry.status) {
      bodyKey = "changed_status_to";
      bodyParams.status = status;
    } else if (assigned_to && oldInquiry && assigned_to !== oldInquiry.assigned_to) {
      bodyKey = "assigned_to_you";
    } else {
      bodyKey = "updated_inquiry";
    }

    await Promise.all(
      recipients.map((recipientId) =>
        createNotification({
          userId: recipientId,
          titleKey: "inquiry_updated",
          bodyKey,
          bodyParams: { ...bodyParams, title: updated.title },
          data: {
            type: "inquiries",
            rowId: ticketId,
            screen: "Inquiry",
            params: { ticketId },
          },
        }),
      ),
    );
  }

  return updated;
};

// ─── 4. Delete (atomic cascade) ───────────────────────────────────────────────

export const deleteInquiry = async ({ ticketId, userBU }) => {
  const id = parseInt(ticketId, 10);
  if (isNaN(id)) throw new ValidationError("invalid_ticket_id");

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const exists = await inquiryRepo.findInquiryById(id, userBU, client);
    if (exists === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }

    // Delete S3 objects before touching DB rows
    const attachKeys = await inquiryRepo.findInquiryAttachmentKeys(id, userBU, client);
    for (const { s3_key } of attachKeys) {
      await deleteFromS3(s3_key);
    }

    await inquiryRepo.cascadeDeleteInquiry(id, userBU, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── 5. Issue types ───────────────────────────────────────────────────────────

export const getIssues = async ({ userId, businessUnit }) => {
  const lang = await getUserLanguage(userId);
  return inquiryRepo.findIssues(lang, businessUnit);
};

// ─── 6. Officers by BU ────────────────────────────────────────────────────────

export const getOfficersByBU = async ({ businessUnit }) => {
  return inquiryRepo.findOfficersByBU(businessUnit);
};
