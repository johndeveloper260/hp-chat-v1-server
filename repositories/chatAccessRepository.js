/**
 * Chat access repository.
 *
 * Answers "who may this account start a conversation with", server-side.
 *
 * The clients discover chat partners through Stream's own queryUsers with
 * client-side filters (hp-chat-web UserListModal, hp-chat-v1 UserListScreen).
 * Those filters are suggestions: a modified client, or any caller holding the
 * user's Stream token, can query the whole app. Everything here is the
 * authoritative answer the backend enforces on top of them.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

const db = (client) => client ?? getPool();

/**
 * The contact set for a SOUSER: inside their authorised BUs, and limited to
 * their own sending organisation — plus the coordinators who look after them.
 *
 * Three branches:
 *   employees of the same sending organisation
 *   fellow SOUSERs of the same sending organisation (with live BU access)
 *   OFFICER/ADMIN coordinators in those BUs — "allow coordinator contact
 *     within authorised BUs"; they are staff, not members of any organisation,
 *     so the sending_org filter must not apply to them.
 *
 * Only non-sensitive display fields are selected. A shared sending organisation
 * is a reason to be able to message someone, not a reason to see their
 * addresses, visa dates or emergency contacts.
 */
export const findSouserContacts = async ({ businessUnits, sendingOrg, search = null }, client) => {
  const buList = (businessUnits ?? []).filter(Boolean).map(String);
  if (!buList.length || !sendingOrg) return [];

  const like = search ? `%${search}%` : null;

  const { rows } = await db(client).query(
    `SELECT id, fn, mn, ln, user_type, business_unit, sending_org, company, company_name, batch_no, last_active
     FROM (
       SELECT a.id::text AS id, p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln,
              UPPER(p.user_type) AS user_type, a.business_unit, p.sending_org, p.company, c.company_name->>'en' AS company_name, p.batch_no, a.last_seen AS last_active
       FROM v4.user_account_tbl a
       JOIN v4.user_profile_tbl p ON p.user_id = a.id
       LEFT JOIN v4.company_tbl c ON c.company_id::text = p.company
       WHERE a.business_unit = ANY($1::text[])
         AND a.is_active = true
         AND UPPER(COALESCE(p.user_type, 'USER')) NOT IN ('OFFICER', 'ADMIN')
         AND p.sending_org = $2

       UNION

       SELECT a.id::text, su.first_name, NULL, su.last_name,
              'SOUSER', a.business_unit, su.sending_org, NULL, NULL, NULL, a.last_seen
       FROM v4.user_account_tbl a
       JOIN v4.souser_tbl su ON su.id = a.id
       JOIN v4.souser_bu_access_tbl sba
         ON sba.souser_id = a.id
        AND sba.business_unit = ANY($1::text[])
        AND sba.revoked_at IS NULL
       WHERE a.is_active = true
         AND su.sending_org = $2

       UNION

       SELECT a.id::text, p.first_name, p.middle_name, p.last_name,
              UPPER(p.user_type), a.business_unit, NULL, p.company, c.company_name->>'en', p.batch_no, a.last_seen
       FROM v4.user_account_tbl a
       JOIN v4.user_profile_tbl p ON p.user_id = a.id
       LEFT JOIN v4.company_tbl c ON c.company_id::text = p.company
       WHERE a.business_unit = ANY($1::text[])
         AND a.is_active = true
         AND UPPER(p.user_type) IN ('OFFICER', 'ADMIN')
     ) contacts
     WHERE ($3::text IS NULL OR fn ILIKE $3 OR ln ILIKE $3)`,
    [buList, sendingOrg, like],
  );

  return rows
    .map(({ fn, mn, ln, ...rest }) => ({ ...rest, name: formatDisplayName(ln, fn, mn) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The contact set for a non-SOUSER: their own BU, as today, plus SOUSERs of
 * their own sending organisation who hold access to that BU.
 *
 * The SOUSER branch is what makes contact symmetric — a SOUSER may message an
 * employee of their organisation, so that employee must be able to message back.
 */
export const findStandardContacts = async ({ businessUnit, sendingOrg, isPrivileged, company = null, search = null }, client) => {
  if (!businessUnit) return [];
  const like = search ? `%${search}%` : null;

  const { rows } = await db(client).query(
    `SELECT id, fn, mn, ln, user_type, business_unit, sending_org, company, company_name, batch_no, last_active
     FROM (
       SELECT a.id::text AS id, p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln,
              UPPER(COALESCE(p.user_type, 'USER')) AS user_type, a.business_unit, p.sending_org, p.company, c.company_name->>'en' AS company_name, p.batch_no, a.last_seen AS last_active
       FROM v4.user_account_tbl a
       JOIN v4.user_profile_tbl p ON p.user_id = a.id
       LEFT JOIN v4.company_tbl c ON c.company_id::text = p.company
       WHERE a.business_unit = $1 AND a.is_active = true
         AND ($3::boolean OR UPPER(p.user_type) IN ('OFFICER', 'ADMIN') OR (p.company IS NOT NULL AND p.company = $5))

       UNION

       SELECT a.id::text, su.first_name, NULL, su.last_name,
              'SOUSER', a.business_unit, su.sending_org, NULL, NULL, NULL, a.last_seen
       FROM v4.user_account_tbl a
       JOIN v4.souser_tbl su ON su.id = a.id
       JOIN v4.souser_bu_access_tbl sba
         ON sba.souser_id = a.id
        AND sba.business_unit = $1
        AND sba.revoked_at IS NULL
       WHERE a.is_active = true
         -- An officer coordinates every organisation in the BU; an employee
         -- only ever sees the SOUSERs of their own.
         AND ($3::boolean OR su.sending_org = $2)
     ) contacts
     WHERE ($4::text IS NULL OR fn ILIKE $4 OR ln ILIKE $4)`,
    [businessUnit, sendingOrg ?? null, isPrivileged === true, like, company],
  );

  return rows
    .map(({ fn, mn, ln, ...rest }) => ({ ...rest, name: formatDisplayName(ln, fn, mn) }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

/**
 * The identity a chat authorisation decision is made from — same shape and same
 * "read it from the database, not the token" rule as the announcement side.
 */
export const findChatIdentity = async (userId, client) => {
  const { rows } = await db(client).query(
    `SELECT
       a.id::text AS id,
       a.business_unit,
       a.is_active,
       p.company,
       COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END) AS user_type,
       COALESCE(su.sending_org, p.sending_org) AS sending_org,
       COALESCE(
         (SELECT json_agg(b.business_unit ORDER BY b.business_unit)
          FROM v4.souser_bu_access_tbl b
          WHERE b.souser_id = a.id AND b.revoked_at IS NULL),
         '[]'
       ) AS bu_access
     FROM v4.user_account_tbl a
     LEFT JOIN v4.user_profile_tbl p ON p.user_id = a.id
       LEFT JOIN v4.company_tbl c ON c.company_id::text = p.company
     LEFT JOIN v4.souser_tbl su      ON su.id = a.id
     WHERE a.id = $1::uuid`,
    [userId],
  );
  return rows[0] ?? null;
};
