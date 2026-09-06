/**
 * Feed (Announcement) Repository
 *
 * Raw SQL for v4.announcement_tbl, announcement_views, and related helpers.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";
import { souserFeedPredicate, userFeedPredicate } from "../utils/announcementVisibility.js";

const db = (client) => client ?? getPool();

// ─── Posters (distinct creators) ─────────────────────────────────────────────

export const findPosters = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT
       a.created_by AS value,
       COALESCE(p.first_name, s.first_name) AS fn,
       p.middle_name AS mn,
       COALESCE(p.last_name, s.last_name) AS ln
     FROM v4.announcement_tbl a
     LEFT JOIN v4.user_profile_tbl p ON a.created_by = p.user_id
     LEFT JOIN v4.souser_tbl s ON a.created_by::uuid = s.id
     WHERE a.business_unit = $1`,
    [businessUnit],
  );
  return rows
    .map(({ fn, mn, ln, ...rest }) => ({ ...rest, label: formatDisplayName(ln, fn, mn) }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * The identity every announcement visibility check is decided from.
 *
 * Read from the database on each check rather than taken from the JWT: a token
 * lives 30 days, and a transfer, a revoked BU grant or a changed sending
 * organisation has to bite immediately.
 *
 * Returns the caller's own sending organisation from whichever table owns it —
 * user_profile_tbl for an employee, souser_tbl for a SOUSER — which is what
 * lets an employee of the authoring organisation read a SOUSER's bulletin.
 */
export const findViewerIdentity = async (userId, client) => {
  const { rows } = await db(client).query(
    `SELECT
       a.id::text AS id,
       a.business_unit,
       COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END) AS user_type,
       p.company,
       COALESCE(su.sending_org, p.sending_org) AS sending_org,
       COALESCE(su.country, p.country)         AS country,
       COALESCE(
         (SELECT json_agg(json_build_object(
                   'business_unit', b.business_unit,
                   'announcements_read', b.announcements_read,
                   'announcements_write', b.announcements_write)
                 ORDER BY b.business_unit)
          FROM v4.souser_bu_access_tbl b
          WHERE b.souser_id = a.id AND b.revoked_at IS NULL),
         '[]'
       ) AS bu_access
     FROM v4.user_account_tbl a
     LEFT JOIN v4.user_profile_tbl p ON p.user_id = a.id
     LEFT JOIN v4.souser_tbl su      ON su.id = a.id
     WHERE a.id = $1::uuid AND a.is_active = true`,
    [userId],
  );
  return rows[0] ?? null;
};

/**
 * Distinct creators of the bulletins one sending organisation can actually see,
 * across the SOUSER's authorised BUs. Mirrors the SOUSER branch of
 * canViewAnnouncement so the poster filter cannot name an author whose posts
 * the caller would never be shown.
 */
export const findPostersForSendingOrg = async (businessUnits, sendingOrg, client) => {
  const buList = (businessUnits ?? []).filter(Boolean).map(String);
  if (!buList.length || !sendingOrg) return [];

  const { rows } = await db(client).query(
    `SELECT DISTINCT
       a.created_by AS value,
       COALESCE(p.first_name, s.first_name) AS fn,
       p.middle_name AS mn,
       COALESCE(p.last_name, s.last_name) AS ln
     FROM v4.announcement_tbl a
     LEFT JOIN v4.user_profile_tbl p ON a.created_by = p.user_id
     LEFT JOIN v4.souser_tbl s ON a.created_by::uuid = s.id
     WHERE a.business_unit = ANY($1::text[])
       AND (
         CASE
           WHEN a.created_by_sending_org IS NOT NULL
           THEN a.created_by_sending_org = $2
           ELSE (a.sending_org IS NULL OR a.sending_org = $2)
         END
       )`,
    [buList, sendingOrg],
  );
  return rows
    .map(({ fn, mn, ln, ...rest }) => ({ ...rest, label: formatDisplayName(ln, fn, mn) }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

// ─── Fetch announcements (dynamic query) ──────────────────────────────────────

/**
 * @param {object}   p
 * @param {string[]} p.businessUnits - every BU the caller may read from. One
 *   entry for USER/OFFICER/ADMIN; a SOUSER's full authorised list otherwise.
 * @param {object|null} p.souser - { sendingOrg, country } when the caller is a
 *   SOUSER. Its presence selects the SOUSER branch of the visibility predicate.
 */
export const findAnnouncements = async ({ lang, userId, company_filter, businessUnits, isOfficer, isManagement, souser = null, client }) => {
  let query = `
    SELECT
      a.row_id,
      a.business_unit,
      a.company AS company_ids,
      a.batch_no,
      a.country,
      a.sending_org,
      a.created_by_sending_org,
      ARRAY(
        SELECT COALESCE(c.company_name->>$1, c.company_name->>'en')
        FROM v4.company_tbl c
        WHERE c.company_id = ANY(a.company::uuid[])
        ORDER BY c.sort_order ASC
      ) AS target_companies,
      a.title,
      a.content_text,
      a.reactions,
      a.date_from,
      a.date_to,
      a.active,
      (SELECT COUNT(*) FROM v4.shared_comments
       WHERE relation_id = a.row_id AND relation_type = 'announcements') AS comment_count,
      (SELECT COUNT(*) FROM v4.announcement_views
       WHERE announcement_id = a.row_id::integer) AS view_count,
      EXISTS(SELECT 1 FROM v4.announcement_views
             WHERE announcement_id = a.row_id::integer AND user_id = $2::uuid) AS has_viewed,
      EXISTS(SELECT 1 FROM v4.announcement_favorites
             WHERE row_id = a.row_id AND user_id = $2::uuid) AS is_favorited,
      a.comments_on,
      a.created_by,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
      COALESCE(u.first_name, creator_souser.first_name) AS cb_fn,
      u.middle_name AS cb_mn,
      COALESCE(u.last_name, creator_souser.last_name) AS cb_ln,
      sa.attachment_id AS author_profile_pic_id,
      COALESCE(
        (
          SELECT json_agg(att)
          FROM (
            SELECT attachment_id, s3_key, s3_bucket,
                   display_name, file_type,
                   display_name AS name, file_type AS type
            FROM v4.shared_attachments
            WHERE relation_type = 'announcements' AND relation_id = a.row_id::text
          ) att
        ), '[]'
      ) AS attachments
    FROM v4.announcement_tbl a
    LEFT JOIN v4.user_profile_tbl u ON a.created_by = u.user_id
    LEFT JOIN v4.souser_tbl creator_souser ON a.created_by::uuid = creator_souser.id
    LEFT JOIN v4.user_profile_tbl requester ON requester.user_id = $2::uuid
    LEFT JOIN LATERAL (
      SELECT attachment_id
      FROM v4.shared_attachments
      WHERE relation_type = 'profile' AND relation_id = a.created_by::text
      ORDER BY created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE 1=1
  `;

  const values = [lang, userId];

  if (souser && isManagement) {
    query += ` AND (a.created_by = $2::uuid OR (a.active = true
      AND (a.date_from IS NULL OR a.date_from <= CURRENT_DATE)
      AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)))`;
  } else if (!(isOfficer && isManagement)) {
    // Home feed: always restrict to active, within date range (all users)
    query += ` AND a.active = true`;
    query += ` AND (a.date_from IS NULL OR a.date_from <= CURRENT_DATE)`;
    query += ` AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)`;
  }

  if (isOfficer) {
    // Officers see everything in their BU — no extra targeting filters. This
    // bypass is BU-bounded, so it cannot reach another BU's SOUSER bulletins.
  } else if (souser) {
    // SOUSER: organisation-scoped. Country no longer gates access on its own —
    // the previous "must explicitly target my country AND my sending_org" rule
    // hid every untargeted bulletin from every SOUSER.
    values.push(souser.sendingOrg);
    const orgParam = `$${values.length}`;
    values.push(souser.country ?? null);
    const countryParam = `$${values.length}`;
    query += ` AND ${souserFeedPredicate({ orgParam, countryParam })}`;
  } else {
    // Regular users: null/empty fields on the announcement mean "global".
    let companyClause;
    if (company_filter) {
      values.push(company_filter);
      companyClause = `($${values.length} = ANY(a.company::uuid[]) OR a.company IS NULL OR cardinality(a.company) = 0)`;
    } else {
      companyClause = `(a.company IS NULL OR cardinality(a.company) = 0)`;
    }
    query += ` AND ${userFeedPredicate({ companyClause })}`;
  }

  // BU boundary. Always applied — an empty list means the caller has no
  // authorised BU and must see nothing, so it is a caller error, not a no-op.
  const buList = (businessUnits ?? []).filter(Boolean).map(String);
  if (!buList.length) return [];
  values.push(buList);
  query += ` AND a.business_unit = ANY($${values.length}::text[])`;

  query += ` ORDER BY a.created_at DESC`;

  const { rows } = await db(client).query(query, values);
  return rows.map(({ cb_fn, cb_mn, cb_ln, ...rest }) => ({
    ...rest,
    created_by_name: formatDisplayName(cb_ln, cb_fn, cb_mn),
  }));
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const insertAnnouncement = async (fields, client) => {
  const { userBU, company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on, userId, createdBySendingOrg = null } = fields;
  const { rows } = await db(client).query(
    `INSERT INTO v4.announcement_tbl (
       business_unit, company, batch_no, country, sending_org, title, content_text,
       date_from, date_to, active, comments_on, created_by_sending_org,
       created_by, created_at, last_updated_by, last_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $13, $12::uuid, NOW(), $12::uuid, NOW())
     RETURNING *`,
    [userBU, company, batch_no || null, country?.length ? country : null, sending_org || null, title, content_text, date_from, date_to, active, comments_on, userId, createdBySendingOrg || null],
  );
  return rows[0];
};

// ─── Read ─────────────────────────────────────────────────────────────────────

export const findAnnouncementById = async (rowId, userBU, client) => {
  const { rows } = await db(client).query(
    "SELECT * FROM v4.announcement_tbl WHERE row_id = $1::integer AND business_unit = $2",
    [rowId, userBU],
  );
  return rows[0] ?? null;
};

/**
 * Fetch one announcement by id alone, for the visibility check.
 *
 * Deliberately NOT BU-filtered: the check needs the row's real business_unit to
 * compare against the caller's authorised list. Callers must pass the result
 * through canViewAnnouncement() before exposing anything from it.
 */
export const findAnnouncementForVisibility = async (rowId, client) => {
  const { rows } = await db(client).query(
    `SELECT row_id, business_unit, company, batch_no, country, sending_org,
            created_by, created_by_sending_org, active, date_from, date_to,
            comments_on, title, content_text
     FROM v4.announcement_tbl
     WHERE row_id = $1::integer`,
    [rowId],
  );
  return rows[0] ?? null;
};

/** Returns the display name for a user, or "Someone" if not found. */
export const findUserName = async (userId, client) => {
  // First try to find in user_profile_tbl
  const { rows: userRows } = await db(client).query(
    `SELECT first_name, middle_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1::uuid`,
    [userId],
  );
  if (userRows[0]) {
    return formatDisplayName(userRows[0].last_name, userRows[0].first_name, userRows[0].middle_name);
  }

  // If not found, try to find in souser_tbl
  const { rows: souserRows } = await db(client).query(
    `SELECT first_name, last_name FROM v4.souser_tbl WHERE id = $1::uuid`,
    [userId],
  );
  if (souserRows[0]) {
    return formatDisplayName(souserRows[0].last_name, souserRows[0].first_name, null);
  }

  return "Someone";
};

/**
 * Returns user_id strings for everyone who should be notified about an
 * announcement, excluding its author.
 *
 * The recipient set must not be wider than the read audience — a push
 * notification carries the title and the poster's name, so leaking it leaks the
 * bulletin. The three branches below mirror canViewAnnouncement():
 *
 *   officers/admins in the BU — the moderation bypass, BU-bounded
 *   employees (user_profile_tbl) — targeting filters, or the author's org
 *   SOUSERs (souser_tbl)      — same rules, keyed on their own sending_org
 *
 * @param {string|null} createdBySendingOrg - the author's sending org when the
 *   announcement is SOUSER-authored. When set, every non-officer branch is
 *   restricted to that organisation and nothing else is consulted.
 */
export const findRecipientIds = async (userBU, excludeUserId, company, country, sending_org, createdBySendingOrg = null, client) => {
  const values = [userBU, excludeUserId];
  const accountWhere = `a.business_unit = $1::text AND a.is_active = true AND a.id != $2::uuid`;

  // -- Branch 1: officers/admins (no targeting filters, own BU only) --
  const officerQuery = `
    SELECT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE ${accountWhere}
      AND LOWER(p.user_type) IN ('officer', 'admin')
  `;

  // -- Branch 2: employees --
  let regularQuery = `
    SELECT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE ${accountWhere}
      AND LOWER(p.user_type) NOT IN ('officer', 'admin')
  `;

  // -- Branch 3: SOUSERs. They have no user_profile_tbl row, so the employee
  // branch could never reach them and they were silently never notified.
  // BU access is re-checked here: a revoked grant must stop notifications too.
  let souserQuery = `
    SELECT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.souser_tbl su ON su.id = a.id
    JOIN v4.souser_bu_access_tbl sba
      ON sba.souser_id = a.id
     AND sba.business_unit = $1::text
     AND sba.revoked_at IS NULL
     AND (sba.announcements_read = true OR sba.announcements_write = true)
    WHERE a.is_active = true AND a.id != $2::uuid AND su.sending_org IS NOT NULL AND su.sending_org <> ''
  `;

  if (createdBySendingOrg) {
    // SOUSER-authored: organisation-restricted, full stop. No country, no
    // company — matching the SOUSER-authored branch of canViewAnnouncement.
    values.push(createdBySendingOrg);
    const orgParam = `$${values.length}`;
    regularQuery += ` AND p.sending_org = ${orgParam}`;
    souserQuery += ` AND su.sending_org = ${orgParam}`;
  } else {
    if (company && Array.isArray(company) && company.length > 0) {
      values.push(company);
      regularQuery += ` AND (p.company::uuid = ANY($${values.length}::uuid[]))`;
      // A SOUSER belongs to no company, so a company-targeted post is not theirs.
      souserQuery += ` AND false`;
    }

    if (country && Array.isArray(country) && country.length > 0) {
      values.push(country);
      const countryParam = `$${values.length}`;
      regularQuery += ` AND p.country = ANY(${countryParam}::text[])`;
      souserQuery += ` AND su.country = ANY(${countryParam}::text[])`;
    }

    if (sending_org) {
      values.push(sending_org);
      const orgParam = `$${values.length}`;
      regularQuery += ` AND p.sending_org = ${orgParam}`;
      souserQuery += ` AND su.sending_org = ${orgParam}`;
    }
  }

  const query = `SELECT DISTINCT user_id FROM (${officerQuery} UNION ${regularQuery} UNION ${souserQuery}) combined`;

  const { rows } = await db(client).query(query, values);
  return rows.map((r) => r.user_id);
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateAnnouncement = async (fields, client) => {
  const { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on, userId, rowId, userBU } = fields;
  const { rows } = await db(client).query(
    `UPDATE v4.announcement_tbl
     SET company = $1, batch_no = $2, country = $3, sending_org = $4, title = $5,
         content_text = $6, date_from = $7, date_to = $8,
         active = $9, comments_on = $10,
         last_updated_by = $11::uuid,
         last_updated_at = NOW()
     WHERE row_id = $12::integer AND business_unit = $13
     RETURNING *`,
    [company, batch_no || null, country?.length ? country : null, sending_org || null, title, content_text, date_from, date_to, active, comments_on, userId, rowId, userBU],
  );
  return rows[0] ?? null;
};

// ─── Reactions ────────────────────────────────────────────────────────────────

export const findReactions = async (rowId, userBU) => {
  const { rows, rowCount } = await getPool().query(
    "SELECT reactions FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
    [rowId, userBU],
  );
  return { reactions: rows[0]?.reactions ?? null, rowCount };
};

export const saveReactions = async (rowId, userBU, reactions) => {
  const { rows } = await getPool().query(
    "UPDATE v4.announcement_tbl SET reactions = $1 WHERE row_id = $2 AND business_unit = $3 RETURNING reactions",
    [JSON.stringify(reactions), rowId, userBU],
  );
  return rows[0];
};

/** Fetch user details (name + company) for a list of user IDs. */
export const findUsersForReactions = async (userIds, lang = 'en') => {
  const { rows } = await getPool().query(
    `SELECT a.id, p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln,
            COALESCE(c.company_name->>$2, c.company_name->>'en') AS company
     FROM v4.user_account_tbl a
     LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
     WHERE a.id = ANY($1::uuid[])`,
    [userIds, lang],
  );
  return rows.map(({ fn, mn, ln, ...rest }) => ({ ...rest, name: formatDisplayName(ln, fn, mn) }));
};

// ─── Companies / Batches / Audience ──────────────────────────────────────────

export const findCompaniesWithUsers = async (lang, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT
       c.company_id AS value,
       COALESCE(c.company_name->>$1, c.company_name->>'en') AS label
     FROM v4.company_tbl c
     INNER JOIN v4.user_profile_tbl p ON p.company::uuid = c.company_id
     INNER JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE c.business_unit = $2
       AND c.is_active = true
       AND a.is_active = true
     ORDER BY label ASC`,
    [lang, businessUnit],
  );
  return rows;
};

export const findBatchesByCompany = async (companyId, userBU) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT
       p.batch_no AS value,
       p.batch_no AS label
     FROM v4.user_profile_tbl p
     INNER JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE p.company::uuid = $1::uuid
       AND p.batch_no IS NOT NULL
       AND a.is_active = true
       AND a.business_unit = $2
     ORDER BY p.batch_no ASC`,
    [companyId, userBU],
  );
  return rows;
};

export const countAudience = async (businessUnit, company, batch_no, country, sending_org, createdBySendingOrg = null, client) => {
  // SOUSER-authored preview: the audience is exactly their own organisation in
  // this BU — employees plus fellow SOUSERs — and nothing the caller submitted
  // can widen it. Kept as its own query rather than bolted onto the officer
  // preview below, whose officer branch would otherwise inflate the count with
  // people who are not the intended audience.
  if (createdBySendingOrg) {
    const { rows } = await db(client).query(
      `SELECT COUNT(*) AS count FROM (
         SELECT a.id
         FROM v4.user_account_tbl a
         JOIN v4.user_profile_tbl p ON a.id = p.user_id
         WHERE a.business_unit = $1 AND a.is_active = true
           AND p.sending_org = $2
         UNION
         SELECT a.id
         FROM v4.user_account_tbl a
         JOIN v4.souser_tbl su ON su.id = a.id
         JOIN v4.souser_bu_access_tbl sba
           ON sba.souser_id = a.id AND sba.business_unit = $1 AND sba.revoked_at IS NULL
     AND (sba.announcements_read = true OR sba.announcements_write = true)
         WHERE a.is_active = true AND su.sending_org = $2
       ) combined`,
      [businessUnit, createdBySendingOrg],
    );
    const count = parseInt(rows[0].count) || 0;
    return { count, officers_only: false };
  }

  return countGeneralAudience(businessUnit, company, batch_no, country, sending_org, client);
};

const countGeneralAudience = async (businessUnit, company, batch_no, country, sending_org, client) => {
  // Officers/admins bypass all targeting filters (same as the feed query).
  // Regular users must match all supplied filters.
  // Use UNION to combine both sets before counting.

  // -- Branch 1: officers/admins (no targeting filters applied) --
  let officerQuery = `
    SELECT a.id, p.user_type
    FROM v4.user_account_tbl a
    INNER JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE a.business_unit = $1 AND a.is_active = true
      AND LOWER(p.user_type) IN ('officer', 'admin')
  `;
  const values = [businessUnit];

  // -- Branch 2: regular users (all targeting filters applied) --
  let regularQuery = `
    SELECT a.id, p.user_type
    FROM v4.user_account_tbl a
    INNER JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE a.business_unit = $1 AND a.is_active = true
      AND LOWER(p.user_type) NOT IN ('officer', 'admin')
  `;

  if (company && Array.isArray(company) && company.length > 0) {
    values.push(company);
    regularQuery += ` AND p.company::uuid = ANY($${values.length}::uuid[])`;
  }

  if (batch_no && company && company.length === 1) {
    values.push(batch_no);
    regularQuery += ` AND p.batch_no = $${values.length}`;
  }

  if (country && Array.isArray(country) && country.length > 0) {
    values.push(country);
    regularQuery += ` AND p.country = ANY($${values.length}::text[])`;
  }

  if (sending_org) {
    values.push(sending_org);
    regularQuery += ` AND p.sending_org = $${values.length}`;
  }

  const query = `
    SELECT
      COUNT(DISTINCT id) AS count,
      COUNT(DISTINCT CASE WHEN LOWER(user_type) NOT IN ('officer', 'admin') THEN id END) AS regular_count
    FROM (
      ${officerQuery}
      UNION
      ${regularQuery}
    ) combined
  `;

  const { rows } = await db(client).query(query, values);
  const count = parseInt(rows[0].count) || 0;
  const regularCount = parseInt(rows[0].regular_count) || 0;
  return { count, officers_only: count > 0 && regularCount === 0 };
};

// ─── Views ────────────────────────────────────────────────────────────────────

export const upsertAnnouncementView = async (rowId, userId, userBU) => {
  const pool = getPool();
  await pool.query(
    `INSERT INTO v4.announcement_views (announcement_id, user_id, business_unit)
     VALUES ($1::integer, $2::uuid, $3)
     ON CONFLICT (announcement_id, user_id)
     DO UPDATE SET viewed_at = NOW()`,
    [rowId, userId, userBU],
  );
  await pool.query(
    `UPDATE v4.user_account_tbl SET last_seen = NOW() WHERE id = $1::uuid`,
    [userId],
  );
};

export const findViewers = async (rowId, lang, userBU) => {
  const { rows } = await getPool().query(
    // LEFT JOIN on the profile plus a SOUSER fallback: a SOUSER has no
    // user_profile_tbl row, so the old INNER JOIN dropped them from the viewer
    // list entirely even though mark-seen had recorded them.
    `SELECT
       v.user_id AS id,
       COALESCE(p.first_name, su.first_name) AS fn,
       p.middle_name AS mn,
       COALESCE(p.last_name, su.last_name) AS ln,
       COALESCE(c.company_name->>$2, c.company_name->>'en', su.sending_org) AS company,
       v.viewed_at
     FROM v4.announcement_views v
     LEFT JOIN v4.user_profile_tbl p ON v.user_id = p.user_id
     LEFT JOIN v4.souser_tbl su ON su.id = v.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
     JOIN v4.announcement_tbl a ON v.announcement_id = a.row_id
     WHERE v.announcement_id = $1::integer
       AND (p.user_id IS NOT NULL OR su.id IS NOT NULL)
       AND ($3::text IS NULL OR a.business_unit = $3)
     ORDER BY v.viewed_at DESC`,
    [rowId, lang, userBU],
  );
  return rows.map(({ fn, mn, ln, ...rest }) => ({ ...rest, name: formatDisplayName(ln, fn, mn) }));
};

// ─── Favorites ────────────────────────────────────────────────────────────────

export const toggleFavorite = async (rowId, userId) => {
  const { rows } = await getPool().query(
    `SELECT 1 FROM v4.announcement_favorites WHERE row_id = $1::integer AND user_id = $2::uuid`,
    [rowId, userId],
  );
  if (rows.length > 0) {
    await getPool().query(
      `DELETE FROM v4.announcement_favorites WHERE row_id = $1::integer AND user_id = $2::uuid`,
      [rowId, userId],
    );
    return { is_favorited: false };
  }
  await getPool().query(
    `INSERT INTO v4.announcement_favorites (row_id, user_id) VALUES ($1::integer, $2::uuid)`,
    [rowId, userId],
  );
  return { is_favorited: true };
};

// ─── Delete (cascade) ─────────────────────────────────────────────────────────

export const findAnnouncementAttachmentKeys = async (rowId, userBU, client) => {
  const { rows } = await db(client).query(
    `SELECT s3_key FROM v4.shared_attachments
     WHERE relation_id = $1::text AND relation_type = 'announcements' AND business_unit = $2`,
    [rowId, userBU],
  );
  return rows;
};

export const cascadeDeleteAnnouncement = async (rowId, userBU, client) => {
  await db(client).query(
    `DELETE FROM v4.announcement_favorites WHERE row_id = $1::integer`,
    [rowId],
  );
  await db(client).query(
    `DELETE FROM v4.announcement_views
     WHERE announcement_id = $1::integer AND business_unit = $2`,
    [rowId, userBU],
  );
  await db(client).query(
    `DELETE FROM v4.shared_attachments
     WHERE relation_id = $1::text AND relation_type = 'announcements' AND business_unit = $2`,
    [rowId, userBU],
  );
  await db(client).query(
    `DELETE FROM v4.shared_comments
     WHERE relation_id = $1::integer AND relation_type = 'announcements' AND business_unit = $2`,
    [rowId, userBU],
  );
  await db(client).query(
    `DELETE FROM v4.notification_history_tbl
     WHERE relation_id = $1::text AND relation_type = 'announcements' AND business_unit = $2`,
    [rowId, userBU],
  );
  await db(client).query(
    `DELETE FROM v4.announcement_tbl
     WHERE row_id = $1::integer AND business_unit = $2`,
    [rowId, userBU],
  );
};
