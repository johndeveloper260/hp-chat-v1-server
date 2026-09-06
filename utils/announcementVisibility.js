/**
 * Announcement (bulletin) visibility.
 *
 * ONE definition of who may see a bulletin, in two forms:
 *
 *   canViewAnnouncement()  — pure predicate, for single-record checks
 *                            (details, comments, reactions, attachments,
 *                             viewers, mark-seen, favourite, edit, delete)
 *   souserFeedPredicate()  — the equivalent SQL, for the list query
 *   userFeedPredicate()    — the USER-side half of the same rule
 *
 * The two forms must agree. They are kept in this file, next to each other, and
 * the shared clause names below are the checklist: every branch of the predicate
 * has a matching branch in the SQL and a test in test/announcementVisibility.test.js.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * A bulletin is SOUSER-authored when created_by_sending_org IS NOT NULL. The
 * server sets that column from the authenticated account at insert time; it is
 * never taken from the request body.
 *
 *   SOUSER-authored → visible only to the same sending organisation, inside the
 *                     BU the post lives in. Country plays no part.
 *                     OFFICER/ADMIN in that BU also see it (see below).
 *
 *   officer-authored → general-feed rules, unchanged for USER. A SOUSER reads
 *                      them under the same USER-like rules, with their sending
 *                      organisation standing in for a USER's company.
 *
 * ── Why OFFICER/ADMIN still see SOUSER-authored posts ───────────────────────
 *
 * They are the BU's moderators: souserService lets them create, deactivate and
 * delete the authoring accounts, and deleteAnnouncement is officer-gated. A
 * bulletin they cannot see is a bulletin they cannot moderate. This does not
 * widen the audience across organisations or BUs — an officer's reach is already
 * their own BU and nothing here extends it. It IS a deliberate reading of
 * "visible only to that sending organisation"; see the handoff note.
 */

import { sameSendingOrg, isPrivileged } from "./souserScope.js";

/** An absent scalar or an empty array — i.e. "this field targets nobody in particular". */
const isUntargeted = (v) =>
  v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

const arrayIncludes = (arr, value) =>
  Array.isArray(arr) && value !== null && value !== undefined && value !== "" &&
  arr.some((v) => String(v) === String(value));

/**
 * Is the bulletin currently on the home feed?
 *
 * Deliberately separate from canViewAnnouncement: the list applies this, the
 * single-record checks do not. A user who favourited a post, or commented on
 * one, keeps access after it expires — that was true before this change and
 * narrowing it would be an unrelated behaviour change.
 */
export const isWithinFeedWindow = (announcement, today = new Date()) => {
  if (!announcement?.active) return false;
  const day = today.toISOString().slice(0, 10);
  const from = announcement.date_from ? String(announcement.date_from).slice(0, 10) : null;
  const to = announcement.date_to ? String(announcement.date_to).slice(0, 10) : null;
  if (from && from > day) return false;
  if (to && to < day) return false;
  return true;
};

/** The BUs a viewer may read from. SOUSERs carry a list; everyone else has one. */
export const viewerBusinessUnits = (viewer) => {
  if (Array.isArray(viewer?.businessUnits)) {
    return viewer.businessUnits.map(String);
  }
  return viewer?.businessUnit ? [String(viewer.businessUnit)] : [];
};

/**
 * @param {object} viewer
 * @param {string} viewer.userType     - "USER" | "SOUSER" | "OFFICER" | "ADMIN"
 * @param {string} [viewer.businessUnit]
 * @param {string[]} [viewer.businessUnits] - SOUSER: authorised BUs
 * @param {string} [viewer.sendingOrg]
 * @param {string} [viewer.country]
 * @param {string} [viewer.company]
 * @param {object} announcement - row from v4.announcement_tbl
 * @returns {boolean}
 */
export const canViewAnnouncement = (viewer, announcement) => {
  if (!viewer || !announcement) return false;

  const bus = viewerBusinessUnits(viewer);
  if (!bus.length) return false;                                   // fail closed
  if (!arrayIncludes(bus, announcement.business_unit)) return false; // BU boundary

  const authorOrg = announcement.created_by_sending_org;
  const souserAuthored = authorOrg !== null && authorOrg !== undefined && authorOrg !== "";

  // OFFICER/ADMIN: everything inside their own BU, both kinds.
  if (isPrivileged(viewer)) return true;

  if (souserAuthored) {
    // Organisation-restricted. Country and company are not consulted at all.
    return sameSendingOrg(viewer.sendingOrg, authorOrg);
  }

  // ── General feed rules ─────────────────────────────────────────────────────
  // Identical for USER and SOUSER. A null/empty targeting field means "everyone".

  // sending organisation
  if (!isUntargeted(announcement.sending_org)) {
    if (!sameSendingOrg(viewer.sendingOrg, announcement.sending_org)) return false;
  }

  // country — targeting only, never an independent restriction: an untargeted
  // post reaches every country, which is what unbroke the SOUSER feed.
  if (!isUntargeted(announcement.country)) {
    if (!arrayIncludes(announcement.country, viewer.country)) return false;
  }

  // company — a SOUSER belongs to no company, so a company-targeted post is not
  // for them, exactly as it is not for a USER of a different company.
  if (!isUntargeted(announcement.company)) {
    if (!arrayIncludes(announcement.company, viewer.company)) return false;
  }

  return true;
};

/** May this viewer create/edit/delete? Ownership only — permission is checked separately. */
export const ownsAnnouncement = (viewer, announcement) =>
  !!viewer?.id && !!announcement?.created_by &&
  String(viewer.id) === String(announcement.created_by);

// ── SQL mirrors ──────────────────────────────────────────────────────────────
//
// Composed from named fragments so the list query and the predicate above stay
// legibly parallel. Each takes the $n placeholders it needs from the caller,
// which owns the values array — no literal ever reaches these strings.

/**
 * SOUSER branch of the feed WHERE clause.
 *
 * @param {object} p
 * @param {string} p.orgParam     - $n holding the SOUSER's sending_org
 * @param {string} p.countryParam - $n holding the SOUSER's country
 * @returns {string} SQL predicate
 */
export const souserFeedPredicate = ({ orgParam, countryParam }) => `(
      CASE
        WHEN a.created_by_sending_org IS NOT NULL
        THEN a.created_by_sending_org = ${orgParam}
        ELSE (
              (a.sending_org IS NULL OR a.sending_org = ${orgParam})
          AND (a.country IS NULL OR cardinality(a.country) = 0 OR ${countryParam}::text = ANY(a.country))
          AND (a.company IS NULL OR cardinality(a.company) = 0)
        )
      END
    )`;

/**
 * USER branch of the feed WHERE clause.
 *
 * `requester` is the v4.user_profile_tbl row of the caller, already joined by
 * findAnnouncements. companyClause is passed in because the caller decides
 * whether a company filter is in play.
 */
export const userFeedPredicate = ({ companyClause }) => `(
      CASE
        WHEN a.created_by_sending_org IS NOT NULL
        THEN (requester.sending_org IS NOT NULL AND requester.sending_org = a.created_by_sending_org)
        ELSE (
              (a.sending_org IS NULL OR requester.sending_org = a.sending_org)
          AND (a.country IS NULL OR cardinality(a.country) = 0 OR requester.country = ANY(a.country))
          AND ${companyClause}
        )
      END
    )`;
