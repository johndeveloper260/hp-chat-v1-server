/**
 * Feed (Announcement) Service
 *
 * Business logic for v4.announcement_tbl, reactions, views, and audience queries.
 *
 * Cross-service dependencies:
 *   - sendNotificationToMultipleUsers → notificationService
 *   - deleteFromS3                    → utils/s3Client  (replaces old attachmentController import)
 */
import { getPool }                        from "../config/getPool.js";
import { getUserLanguage }                from "../utils/getUserLanguage.js";
import { deleteFromS3 }                   from "../utils/s3Client.js";
import { sendNotificationToMultipleUsers } from "./notificationService.js";
import * as feedRepo                      from "../repositories/feedRepository.js";
import { NotFoundError }                  from "../errors/AppError.js";

// ─── 1. Posters ───────────────────────────────────────────────────────────────

export const getPosters = async ({ businessUnit }) => {
  return feedRepo.findPosters(businessUnit);
};

// ─── 2. Get announcements (role-filtered, dynamic query) ─────────────────────

export const getAnnouncements = async ({ company_filter, userId, userBU, userType, userCompany, isManagement }) => {
  const lang      = await getUserLanguage(userId);
  const isOfficer = ["ADMIN", "OFFICER"].includes((userType || "").toUpperCase());
  // Non-officers see announcements for their own company (plus global ones).
  // Fall back to the user's company UUID when no explicit filter is supplied.
  const effectiveFilter = company_filter ?? (!isOfficer ? userCompany : undefined);
  return feedRepo.findAnnouncements({ lang, userId, company_filter: effectiveFilter, userBU, isOfficer, isManagement });
};

// ─── 3. Create announcement ───────────────────────────────────────────────────

export const createAnnouncement = async ({ body, userId, userBU, isSouser, souserCountry, souserSendingOrg, souserPrimaryBu }) => {
  let { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on } = body;

  // Sousers: default/override country, sending_org, and business_unit to their own values
  if (isSouser) {
    country = souserCountry ? [souserCountry] : country;
    sending_org = souserSendingOrg ?? sending_org;
    userBU = souserPrimaryBu ?? userBU;
  }

  const newAnnouncement = await feedRepo.insertAnnouncement({
    userBU, company, batch_no, country, sending_org, title, content_text,
    date_from, date_to, active, comments_on, userId,
  });

  // Push notifications only when posting as active
  if (active) {
    const [creatorName, recipientIds] = await Promise.all([
      feedRepo.findUserName(userId),
      feedRepo.findRecipientIds(userBU, userId, company, country, sending_org),
    ]);

    if (recipientIds.length > 0) {
      await sendNotificationToMultipleUsers(
        recipientIds,
        `New Announcement: ${title}`,
        `${creatorName} posted a new announcement`,
        {
          type: "announcement",
          announcementId: newAnnouncement.row_id,
          screen: "HomeScreen",
          params: { rowId: newAnnouncement.row_id },
        },
      );
    }
  }

  return newAnnouncement;
};

// ─── 4. Update announcement ───────────────────────────────────────────────────

export const updateAnnouncement = async ({ rowId, body, userId, userBU }) => {
  const { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on } = body;

  const oldData = await feedRepo.findAnnouncementById(rowId, userBU);
  const updated = await feedRepo.updateAnnouncement({
    company, batch_no, country, sending_org, title, content_text, date_from, date_to,
    active, comments_on, userId, rowId, userBU,
  });
  if (!updated) throw new NotFoundError("record_not_found");

  // Notify when post is newly activated or when active content changes
  const wasActivated   = oldData && !oldData.active && active;
  const titleChanged   = oldData && oldData.title !== title;
  const contentChanged = oldData && oldData.content_text !== content_text;

  if (wasActivated || (active && (titleChanged || contentChanged))) {
    const [updaterName, recipientIds] = await Promise.all([
      feedRepo.findUserName(userId),
      feedRepo.findRecipientIds(updated.business_unit, userId, company, country, sending_org),
    ]);

    if (recipientIds.length > 0) {
      await sendNotificationToMultipleUsers(
        recipientIds,
        wasActivated ? `New Announcement: ${title}` : `Announcement Updated: ${title}`,
        wasActivated ? `${updaterName} posted an announcement` : `${updaterName} updated an announcement`,
        {
          type: "announcement",
          announcementId: rowId,
          screen: "HomeScreen",
          params: { rowId },
        },
      );
    }
  }

  return updated;
};

// ─── 5. Toggle reaction ───────────────────────────────────────────────────────

export const toggleReaction = async ({ rowId, emoji, userId, userBU }) => {
  const { reactions, rowCount } = await feedRepo.findReactions(rowId, userBU);
  if (rowCount === 0) throw new NotFoundError("record_not_found");

  const userIdStr = String(userId);
  const r = { ...(reactions || {}) };
  const isSameEmoji = r[emoji]?.includes(userIdStr);

  // Remove user from all emoji buckets first
  Object.keys(r).forEach((key) => {
    if (Array.isArray(r[key])) r[key] = r[key].filter((id) => id !== userIdStr);
    if (r[key].length === 0) delete r[key];
  });

  // Re-add to new emoji unless toggling off
  if (!isSameEmoji) {
    if (!r[emoji]) r[emoji] = [];
    r[emoji].push(userIdStr);
  }

  return feedRepo.saveReactions(rowId, userBU, r);
};

// ─── 6. Companies / Batches / Audience ───────────────────────────────────────

export const getCompaniesWithUsers = async ({ userId, businessUnit }) => {
  const lang = await getUserLanguage(userId);
  return feedRepo.findCompaniesWithUsers(lang, businessUnit);
};

export const getBatchesByCompany = async ({ companyId, userBU }) => {
  return feedRepo.findBatchesByCompany(companyId, userBU);
};

export const previewAudience = async ({ company, batch_no, country, sending_org, businessUnit }) => {
  return feedRepo.countAudience(businessUnit, company, batch_no, country, sending_org);
};

// ─── 7. Reactions detail ──────────────────────────────────────────────────────

export const getReactions = async ({ rowId, userId, userBU }) => {
  const { reactions, rowCount } = await feedRepo.findReactions(rowId, userBU);
  if (rowCount === 0) throw new NotFoundError("record_not_found");

  const r = reactions || {};
  const userIds = Object.values(r).flat();
  if (userIds.length === 0) return [];

  const lang = await getUserLanguage(userId);
  const users = await feedRepo.findUsersForReactions(userIds, lang);
  const userMap = {};
  users.forEach((u) => { userMap[u.id] = { name: u.name, company: u.company }; });

  return Object.entries(r).map(([emoji, ids]) => ({
    emoji,
    users: ids.map((id) => ({ id, ...userMap[id] })),
  }));
};

// ─── 8. Mark as seen / Get viewers ───────────────────────────────────────────

export const markAsSeen = async ({ rowId, userId, userBU }) => {
  const existing = await feedRepo.findAnnouncementById(rowId, userBU);
  if (!existing) throw new NotFoundError("record_not_found");
  await feedRepo.upsertAnnouncementView(rowId, userId, userBU);
};

export const getViewers = async ({ rowId, userId, userBU }) => {
  const lang = await getUserLanguage(userId);
  return feedRepo.findViewers(rowId, lang, userBU);
};

// ─── 9. Delete (atomic cascade) ───────────────────────────────────────────────

export const deleteAnnouncement = async ({ rowId, userBU }) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const existing = await feedRepo.findAnnouncementById(rowId, userBU, client);
    if (!existing) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }

    // Delete S3 objects before touching DB rows
    const attachKeys = await feedRepo.findAnnouncementAttachmentKeys(rowId, userBU, client);
    for (const { s3_key } of attachKeys) {
      await deleteFromS3(s3_key);
    }

    await feedRepo.cascadeDeleteAnnouncement(rowId, userBU, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
