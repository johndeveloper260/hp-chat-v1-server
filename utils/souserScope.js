/**
 * SOUSER scope resolution.
 *
 * A SOUSER behaves like a USER, except that everything a USER sees scoped by
 * their company, a SOUSER sees scoped by their sending organisation.
 *
 * Two dimensions, both required, both fail-closed:
 *
 *   sending organisation — v4.souser_tbl.sending_org
 *   authorised BUs       — v4.souser_bu_access_tbl rows with revoked_at IS NULL
 *
 * ── How a sending organisation is identified ─────────────────────────────────
 *
 * v4.sending_org_tbl is keyed on (code, business_unit): sendingOrgRepository's
 * countByCode, updateSendingOrgByCode and deleteSendingOrgByCode all qualify
 * `code` with `business_unit`, so `code` alone is NOT unique — the same code in
 * two BUs is two different organisations, and two organisations inside one BU
 * are two different codes.
 *
 * Both sides of every comparison store that code as text:
 *   v4.souser_tbl.sending_org        (the SOUSER's own organisation)
 *   v4.user_profile_tbl.sending_org  (an employee's organisation)
 * and profileRepository joins them with `s.code = p.sending_org AND
 * s.business_unit = a.business_unit`.
 *
 * So the comparison is exact text equality on `code`, always paired with a
 * business-unit check. Not ILIKE, not a case-folded or trimmed compare: those
 * would match rows the (code, business_unit) key treats as distinct, and would
 * disagree with the joins already in the codebase. `country` is NOT part of the
 * identity and must never narrow access on its own — two organisations can share
 * a country, and one organisation can send from several.
 */

const ELEVATED = ["OFFICER", "ADMIN"];

const upper = (v) => String(v ?? "").toUpperCase();

/** True when the authenticated account is a sending-organisation user. */
export const isSouser = (user) => upper(user?.userType) === "SOUSER";

/** True for OFFICER/ADMIN — the BU-wide management roles. */
export const isPrivileged = (user) => ELEVATED.includes(upper(user?.userType));

/**
 * Exact-equality comparison for two sending-org codes, per the rules above.
 * A blank/absent code on either side never matches — including blank vs blank.
 */
export const sameSendingOrg = (a, b) => {
  if (a === null || a === undefined || a === "") return false;
  if (b === null || b === undefined || b === "") return false;
  return String(a) === String(b);
};

/**
 * Normalises the BU-access rows read from v4.souser_bu_access_tbl into the
 * shape the rest of the scope logic uses.
 *
 * Accepts either the repository row shape ({ business_unit, announcements_write })
 * or a bare list of BU codes.
 */
export const normaliseBuAccess = (rows) =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => (typeof r === "string" ? { business_unit: r, announcements_write: false } : r))
    .filter((r) => r && r.business_unit)
    .map((r) => ({
      business_unit: String(r.business_unit),
      announcements_read: r.announcements_read === true,
      announcements_write: r.announcements_write === true,
    }));

/**
 * Builds a SOUSER's effective scope.
 *
 * @param {object} input
 * @param {string} input.id
 * @param {string} input.sendingOrg  - v4.souser_tbl.sending_org
 * @param {Array}  input.buAccess    - non-revoked v4.souser_bu_access_tbl rows
 * @returns {{ id, sendingOrg, businessUnits: string[], writableBusinessUnits: string[], valid: boolean, reason: string|null }}
 *
 * Never throws — callers decide between a 403 and an empty result. `valid` is
 * false when either dimension is missing, which is the fail-closed case:
 * a SOUSER with no sending_org, or with every BU grant revoked, has no scope at
 * all and must be denied rather than silently treated as unscoped.
 */
export const buildSouserScope = ({ id, sendingOrg, buAccess } = {}) => {
  const rows = normaliseBuAccess(buAccess);
  const businessUnits = [...new Set(rows.map((r) => r.business_unit))];
  const writableBusinessUnits = [
    ...new Set(rows.filter((r) => r.announcements_write).map((r) => r.business_unit)),
  ];

  const readableBusinessUnits = [...new Set(rows
    .filter((r) => r.announcements_read || r.announcements_write)
    .map((r) => r.business_unit))];

  const hasOrg = sendingOrg !== null && sendingOrg !== undefined && sendingOrg !== "";

  let reason = null;
  if (!hasOrg && !businessUnits.length) reason = "souser_scope_missing";
  else if (!hasOrg) reason = "souser_sending_org_missing";
  else if (!businessUnits.length) reason = "souser_bu_access_missing";

  return {
    id: id ?? null,
    sendingOrg: hasOrg ? String(sendingOrg) : null,
    businessUnits,
    writableBusinessUnits,
    readableBusinessUnits,
    valid: reason === null,
    reason,
  };
};

/** True when `businessUnit` is one of the SOUSER's non-revoked grants. */
export const isBuAuthorised = (scope, businessUnit) =>
  !!scope?.valid &&
  businessUnit !== null &&
  businessUnit !== undefined &&
  businessUnit !== "" &&
  scope.businessUnits.includes(String(businessUnit));

/**
 * True when the SOUSER may create/edit/delete bulletins in `businessUnit`.
 *
 * This is the "Allow bulletin writing" control. It is presented per account in
 * SO User Management and stored on every non-revoked BU-access row, so the
 * effective check stays per-BU: a revoked BU cannot be written to even while the
 * account-level control is on.
 */
export const canWriteAnnouncements = (scope, businessUnit) =>
  isBuAuthorised(scope, businessUnit) &&
  scope.writableBusinessUnits.includes(String(businessUnit));
