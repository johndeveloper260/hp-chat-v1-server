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
import { ForbiddenError, NotFoundError }  from "../errors/AppError.js";
import { ownsAnnouncement }  from "../utils/announcementVisibility.js";
import {
  resolveViewer,
  loadVisibleAnnouncement,
  assertCanWrite,
} from "./announcementAccess.js";

// ─── 1. Posters ───────────────────────────────────────────────────────────────

export const getPosters = async (user) => {
  const viewer = await resolveViewer(user.id);
  // A SOUSER may only filter by authors whose posts they can actually see, so
  // the list is restricted to their own organisation inside their own BUs.
  if (viewer.userType === "SOUSER") {
    return feedRepo.findPostersForSendingOrg(viewer.businessUnits, viewer.sendingOrg);
  }
  return feedRepo.findPosters(viewer.businessUnit);
};

// ─── 2. Get announcements (role-filtered, dynamic query) ─────────────────────

export const getAnnouncements = async ({ company_filter, user, isManagement }) => {
  const viewer    = await resolveViewer(user.id);
  const lang      = await getUserLanguage(viewer.id);
  const isOfficer = ["OFFICER", "ADMIN"].includes(viewer.userType);

  // Regular users are always scoped by their current DB company. Never trust
  // a client-supplied company filter for authorization.
  const effectiveFilter = isOfficer ? company_filter : viewer.company;

  return feedRepo.findAnnouncements({
    lang,
    userId: viewer.id,
    company_filter: effectiveFilter,
    businessUnits: viewer.businessUnits,
    isOfficer,
    isManagement,
    souser: viewer.userType === "SOUSER"
      ? { sendingOrg: viewer.sendingOrg, country: viewer.country }
      : null,
  });
};

// ─── 3. Create announcement ───────────────────────────────────────────────────

export const createAnnouncement = async ({ body, user }) => {
  const viewer = await resolveViewer(user.id);
  let { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on } = body;

  let userBU = viewer.businessUnit;
  let createdBySendingOrg = null;

  if (viewer.userType === "SOUSER") {
    // Everything that decides who sees this post is derived from the
    // authenticated account. The submitted audience fields are discarded
    // outright — previously `company` and `batch_no` were passed straight
    // through from the body, so a SOUSER could address a company they have no
    // relationship with by posting the ids directly.
    userBU = viewer.businessUnits.includes(String(viewer.businessUnit))
      ? String(viewer.businessUnit)
      : null;
    if (!userBU) {
      throw new ForbiddenError("souser_bu_access_missing", "api_errors.souser.bu_access_missing");
    }
    assertCanWrite(viewer, userBU);

    createdBySendingOrg = viewer.sendingOrg;
    sending_org = viewer.sendingOrg;
    country     = viewer.country ? [viewer.country] : null;
    company     = null;
    batch_no    = null;
  }

  const newAnnouncement = await feedRepo.insertAnnouncement({
    userBU, company, batch_no, country, sending_org, title, content_text,
    date_from, date_to, active, comments_on, userId: viewer.id, createdBySendingOrg,
  });

  // Push notifications only when posting as active
  if (active) {
    const [creatorName, recipientIds] = await Promise.all([
      feedRepo.findUserName(viewer.id),
      feedRepo.findRecipientIds(userBU, viewer.id, company, country, sending_org, createdBySendingOrg),
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

export const updateAnnouncement = async ({ rowId, body, user }) => {
  let { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on } = body;

  // Visibility first: a SOUSER must not learn that a row exists in another
  // organisation by watching a 403 come back instead of a 404.
  const { row: oldData, viewer } = await loadVisibleAnnouncement(user.id, rowId);
  const userBU = oldData.business_unit;

  if (viewer.userType === "SOUSER") {
    assertCanWrite(viewer, userBU);
    // Own posts only. BU membership was never enough on its own — it let any
    // SOUSER with the write flag edit another organisation's bulletin.
    if (!ownsAnnouncement(viewer, oldData)) {
      throw new ForbiddenError("souser_not_announcement_owner", "api_errors.souser.not_owner");
    }
    // Audience stays what the server derived at creation.
    company     = oldData.company;
    batch_no    = oldData.batch_no;
    country     = oldData.country;
    sending_org = oldData.created_by_sending_org;
  }

  const updated = await feedRepo.updateAnnouncement({
    company, batch_no, country, sending_org, title, content_text, date_from, date_to,
    active, comments_on, userId: viewer.id, rowId, userBU,
  });
  if (!updated) throw new NotFoundError("record_not_found");

  // Notify when post is newly activated or when active content changes
  const wasActivated   = oldData && !oldData.active && active;
  const titleChanged   = oldData && oldData.title !== title;
  const contentChanged = oldData && oldData.content_text !== content_text;

  if (wasActivated || (active && (titleChanged || contentChanged))) {
    const [updaterName, recipientIds] = await Promise.all([
      feedRepo.findUserName(viewer.id),
      feedRepo.findRecipientIds(
        updated.business_unit, viewer.id, company, country, sending_org,
        // Re-notifying must not reach further than the original audience.
        oldData.created_by_sending_org,
      ),
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

export const toggleReaction = async ({ rowId, emoji, user }) => {
  const { row } = await loadVisibleAnnouncement(user.id, rowId);
  const userBU = row.business_unit;

  const { reactions, rowCount } = await feedRepo.findReactions(rowId, userBU);
  if (rowCount === 0) throw new NotFoundError("record_not_found");

  const userIdStr = String(user.id);
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

/**
 * Company and batch pickers exist so an officer can target a bulletin at a
 * company. A SOUSER cannot target one — createAnnouncement discards company and
 * batch_no for them — so exposing the BU's company and batch roster to a SOUSER
 * would hand over organisational data they have no use for and no claim to.
 */
const assertAudienceTargetingAllowed = (viewer) => {
  if (viewer.userType === "SOUSER") {
    throw new ForbiddenError("souser_cannot_target_company", "api_errors.souser.cannot_target_company");
  }
};

export const getCompaniesWithUsers = async (user) => {
  const viewer = await resolveViewer(user.id);
  assertAudienceTargetingAllowed(viewer);
  const lang = await getUserLanguage(viewer.id);
  return feedRepo.findCompaniesWithUsers(lang, viewer.businessUnit);
};

export const getBatchesByCompany = async ({ companyId, user }) => {
  const viewer = await resolveViewer(user.id);
  assertAudienceTargetingAllowed(viewer);
  return feedRepo.findBatchesByCompany(companyId, viewer.businessUnit);
};

export const previewAudience = async ({ company, batch_no, country, sending_org, user }) => {
  const viewer = await resolveViewer(user.id);

  if (viewer.userType === "SOUSER") {
    // The preview must show the audience the post would actually reach, which
    // is derived, not submitted. Returning a count for a submitted audience
    // would leak BU-wide headcount to an account that cannot post to it.
    const businessUnit = String(viewer.businessUnit);
    if (!viewer.businessUnits.includes(businessUnit)) {
      throw new ForbiddenError("souser_bu_access_missing", "api_errors.souser.bu_access_missing");
    }
    return feedRepo.countAudience(businessUnit, null, null, null, null, viewer.sendingOrg);
  }

  return feedRepo.countAudience(viewer.businessUnit, company, batch_no, country, sending_org);
};

// ─── 7. Reactions detail ──────────────────────────────────────────────────────

export const getReactions = async ({ rowId, user }) => {
  const { row } = await loadVisibleAnnouncement(user.id, rowId);

  const { reactions, rowCount } = await feedRepo.findReactions(rowId, row.business_unit);
  if (rowCount === 0) throw new NotFoundError("record_not_found");

  const r = reactions || {};
  const userIds = Object.values(r).flat();
  if (userIds.length === 0) return [];

  const lang = await getUserLanguage(user.id);
  const users = await feedRepo.findUsersForReactions(userIds, lang);
  const userMap = {};
  users.forEach((u) => { userMap[u.id] = { name: u.name, company: u.company }; });

  return Object.entries(r).map(([emoji, ids]) => ({
    emoji,
    users: ids.map((id) => ({ id, ...userMap[id] })),
  }));
};

// ─── 8. Mark as seen / Get viewers ───────────────────────────────────────────

export const markAsSeen = async ({ rowId, user }) => {
  const { row } = await loadVisibleAnnouncement(user.id, rowId);
  await feedRepo.upsertAnnouncementView(rowId, user.id, row.business_unit);
};

export const getViewers = async ({ rowId, user }) => {
  const { row } = await loadVisibleAnnouncement(user.id, rowId);
  const lang = await getUserLanguage(user.id);
  return feedRepo.findViewers(rowId, lang, row.business_unit);
};

// ─── 9. Toggle favorite ───────────────────────────────────────────────────────

export const toggleFavorite = async ({ rowId, user }) => {
  // Favouriting is a read-side action, but it writes a row keyed to the
  // announcement — without this check any authenticated account could pin a
  // bulletin it cannot see and confirm the row_id exists.
  await loadVisibleAnnouncement(user.id, rowId);
  return feedRepo.toggleFavorite(rowId, user.id);
};

// ─── 10. Delete (atomic cascade) ──────────────────────────────────────────────

export const deleteAnnouncement = async ({ rowId, user }) => {
  const { row: existing, viewer } = await loadVisibleAnnouncement(user.id, rowId);
  const userBU = existing.business_unit;

  if (viewer.userType === "SOUSER") {
    assertCanWrite(viewer, userBU);
    if (!ownsAnnouncement(viewer, existing)) {
      throw new ForbiddenError("souser_not_announcement_owner", "api_errors.souser.not_owner");
    }
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

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
