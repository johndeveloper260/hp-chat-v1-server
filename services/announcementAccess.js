/**
 * Announcement access checks, shared by every service that can reach a bulletin.
 *
 * feedService owns the bulletin itself, but comments, attachments and
 * notifications all hang off one by relation_id and were each gated on nothing
 * more than "same business unit". That was enough to read a bulletin's comment
 * thread, or download its attachments, from an organisation the bulletin was
 * never addressed to. They all go through loadVisibleAnnouncement() now.
 *
 * Lives in its own module rather than in feedService so commentsService and
 * attachmentService can import it without pulling in S3 and the notification
 * fan-out.
 */
import * as feedRepo from "../repositories/feedRepository.js";
import { ForbiddenError, NotFoundError } from "../errors/AppError.js";
import { buildSouserScope, canWriteAnnouncements } from "../utils/souserScope.js";
import { canViewAnnouncement } from "../utils/announcementVisibility.js";

const ELEVATED = ["OFFICER", "ADMIN"];

/**
 * Builds the viewer used by canViewAnnouncement(), from the database.
 *
 * The caller's own sending organisation decides whether a SOUSER-authored
 * bulletin is theirs to read, and req.user does not carry it for an employee —
 * only a SOUSER's is on the token. Resolving both sides here keeps one rule for
 * everyone and keeps the check on live data, per the repo's "never trust JWT
 * claims for authorization" convention.
 *
 * Fails closed for a SOUSER whose scope is incomplete — no sending organisation,
 * or every BU grant revoked. Such an account has no audience it belongs to, so
 * every announcement read and write is denied rather than falling through to
 * "unscoped", which would have meant "everything".
 *
 * @param {string} userId
 * @param {import('pg').PoolClient} [client]
 */
export const resolveViewer = async (userId, client) => {
  const row = await feedRepo.findViewerIdentity(userId, client);
  if (!row) throw new ForbiddenError("account_not_found", "api_errors.auth.account_deactivated");

  const userType = String(row.user_type || "USER").toUpperCase();

  if (userType === "SOUSER") {
    const scope = buildSouserScope({
      id: row.id,
      sendingOrg: row.sending_org,
      buAccess: row.bu_access,
    });
    if (!scope.valid) {
      throw new ForbiddenError(scope.reason, "api_errors.souser.scope_missing");
    }
    return {
      id: row.id,
      userType: "SOUSER",
      businessUnit: row.business_unit,
      businessUnits: scope.readableBusinessUnits,
      sendingOrg: scope.sendingOrg,
      country: row.country ?? null,
      company: null,
      scope,
    };
  }

  return {
    id: row.id,
    userType: ELEVATED.includes(userType) ? userType : "USER",
    businessUnit: row.business_unit,
    businessUnits: row.business_unit ? [String(row.business_unit)] : [],
    sendingOrg: row.sending_org ?? null,
    country: row.country ?? null,
    company: row.company ?? null,
    scope: null,
  };
};

/**
 * Loads an announcement and asserts the caller may see it.
 *
 * Every per-record route goes through here — details, comments, reactions,
 * attachments, viewers, mark-seen, favourite, edit, delete — so a direct request
 * with a guessed row_id cannot reach a bulletin the feed would not have listed.
 * A denial is a 404, not a 403: existence itself is scoped information.
 */
export const loadVisibleAnnouncement = async (userId, rowId, client) => {
  const viewer = await resolveViewer(userId, client);
  const row = await feedRepo.findAnnouncementForVisibility(rowId, client);
  if (!row || !canViewAnnouncement(viewer, row)) throw new NotFoundError("record_not_found");
  return { row, viewer };
};

/** True when the caller can see the bulletin. Never throws on a plain denial. */
export const isAnnouncementVisible = async (userId, rowId, client) => {
  try {
    await loadVisibleAnnouncement(userId, rowId, client);
    return true;
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return false;
    throw err;
  }
};

/**
 * May the caller change this bulletin — including adding or removing its
 * attachments? Officers moderate their BU; a SOUSER may only touch their own
 * posts, and only while the "Allow bulletin writing" control is on for that BU.
 * A plain USER never can.
 */
export const canModifyAnnouncement = async (userId, rowId, client) => {
  let row, viewer;
  try {
    ({ row, viewer } = await loadVisibleAnnouncement(userId, rowId, client));
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) return false;
    throw err;
  }

  if (ELEVATED.includes(viewer.userType)) return true;
  if (viewer.userType !== "SOUSER") return false;

  return canWriteAnnouncements(viewer.scope, row.business_unit) &&
         String(row.created_by) === String(viewer.id);
};

/**
 * Asserts the caller may write (create/edit/delete) in `businessUnit`.
 * For a SOUSER that is the "Allow bulletin writing" control, checked per BU.
 */
export const assertCanWrite = (viewer, businessUnit) => {
  if (viewer.userType !== "SOUSER") return;
  if (!canWriteAnnouncements(viewer.scope, businessUnit)) {
    throw new ForbiddenError(
      "souser_announcements_write_denied",
      "api_errors.souser.announcements_write_denied",
    );
  }
};
