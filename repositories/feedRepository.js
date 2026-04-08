/**
 * Feed (Announcement) Repository
 *
 * Raw SQL for v4.announcement_tbl, announcement_views, and related helpers.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

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

// ─── Fetch announcements (dynamic query) ──────────────────────────────────────

export const findAnnouncements = async ({ lang, userId, company_filter, userBU, isOfficer, isManagement }) => {
  let query = `
    SELECT
      a.row_id,
      a.business_unit,
      a.company AS company_ids,
      a.batch_no,
      a.country,
      a.sending_org,
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
            SELECT attachment_id, s3_key, s3_bucket, display_name AS name, file_type AS type
            FROM v4.shared_attachments
            WHERE relation_type = 'announcements' AND relation_id = a.row_id::text
          ) att
        ), '[]'
      ) AS attachments
    FROM v4.announcement_tbl a
    LEFT JOIN v4.user_profile_tbl u ON a.created_by = u.user_id
    LEFT JOIN v4.souser_tbl creator_souser ON a.created_by::uuid = creator_souser.id
    LEFT JOIN v4.user_profile_tbl requester ON requester.user_id = $2::uuid
    LEFT JOIN v4.souser_tbl souser_req ON souser_req.id = $2::uuid
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

  if (!(isOfficer && isManagement)) {
    // Home feed: always restrict to active, within date range (all users)
    query += ` AND a.active = true`;
    query += ` AND (a.date_from IS NULL OR a.date_from <= CURRENT_DATE)`;
    query += ` AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)`;
  }

  if (isOfficer) {
    // Officers see everything in the BU — no extra targeting filters
  } else {
    // Sousers: strict match — announcement must explicitly target their country and sending_org
    // Regular users: null/empty fields on the announcement mean "global" (shown to all)
    query += ` AND (
      CASE
        WHEN souser_req.id IS NOT NULL
        THEN (a.country IS NOT NULL AND cardinality(a.country) > 0 AND souser_req.country = ANY(a.country))
        ELSE (a.country IS NULL OR cardinality(a.country) = 0 OR requester.country = ANY(a.country))
      END
    )`;
    query += ` AND (
      CASE
        WHEN souser_req.id IS NOT NULL
        THEN (a.sending_org IS NOT NULL AND souser_req.sending_org = a.sending_org)
        ELSE (a.sending_org IS NULL OR requester.sending_org = a.sending_org)
      END
    )`;

    if (company_filter) {
      values.push(company_filter);
      query += ` AND ($${values.length} = ANY(a.company::uuid[]) OR a.company IS NULL OR cardinality(a.company) = 0)`;
    } else {
      query += ` AND (a.company IS NULL OR cardinality(a.company) = 0)`;
    }
  }

  if (userBU) {
    values.push(userBU);
    query += ` AND a.business_unit = $${values.length}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  const { rows } = await getPool().query(query, values);
  return rows.map(({ cb_fn, cb_mn, cb_ln, ...rest }) => ({
    ...rest,
    created_by_name: formatDisplayName(cb_ln, cb_fn, cb_mn),
  }));
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const insertAnnouncement = async (fields) => {
  const { userBU, company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on, userId } = fields;
  const { rows } = await getPool().query(
    `INSERT INTO v4.announcement_tbl (
       business_unit, company, batch_no, country, sending_org, title, content_text,
       date_from, date_to, active, comments_on,
       created_by, created_at, last_updated_by, last_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::uuid, NOW(), $12::uuid, NOW())
     RETURNING *`,
    [userBU, company, batch_no || null, country?.length ? country : null, sending_org || null, title, content_text, date_from, date_to, active, comments_on, userId],
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
 * Returns user_id strings for all active BU users (excluding the poster),
 * optionally filtered by company, country, and sending_org.
 */
export const findRecipientIds = async (userBU, excludeUserId, company, country, sending_org) => {
  // Officers/admins bypass all targeting filters (same as the feed query).
  // Regular users must match all supplied filters.

  const values = [userBU, excludeUserId];
  const baseWhere = `a.business_unit = $1::text AND a.is_active = true AND a.id != $2::uuid`;

  // -- Branch 1: officers/admins (no targeting filters) --
  let officerQuery = `
    SELECT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE ${baseWhere}
      AND LOWER(p.user_type) IN ('officer', 'admin')
  `;

  // -- Branch 2: regular users (all targeting filters applied) --
  let regularQuery = `
    SELECT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE ${baseWhere}
      AND LOWER(p.user_type) NOT IN ('officer', 'admin')
  `;

  if (company && Array.isArray(company) && company.length > 0) {
    values.push(company);
    regularQuery += ` AND (p.company::uuid = ANY($${values.length}::uuid[]) OR p.company IS NULL)`;
  }

  if (country && Array.isArray(country) && country.length > 0) {
    values.push(country);
    regularQuery += ` AND p.country = ANY($${values.length}::text[])`;
  }

  if (sending_org) {
    values.push(sending_org);
    regularQuery += ` AND p.sending_org = $${values.length}`;
  }

  const query = `SELECT DISTINCT user_id FROM (${officerQuery} UNION ${regularQuery}) combined`;

  const { rows } = await getPool().query(query, values);
  return rows.map((r) => r.user_id);
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateAnnouncement = async (fields) => {
  const { company, batch_no, country, sending_org, title, content_text, date_from, date_to, active, comments_on, userId, rowId, userBU } = fields;
  const { rows } = await getPool().query(
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

export const countAudience = async (businessUnit, company, batch_no, country, sending_org) => {
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

  const { rows } = await getPool().query(query, values);
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
    `SELECT
       v.user_id AS id,
       p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln,
       COALESCE(c.company_name->>$2, c.company_name->>'en') AS company,
       v.viewed_at
     FROM v4.announcement_views v
     JOIN v4.user_profile_tbl p ON v.user_id = p.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
     JOIN v4.announcement_tbl a ON v.announcement_id = a.row_id
     WHERE v.announcement_id = $1::integer
       AND ($3::text IS NULL OR a.business_unit = $3)
     ORDER BY v.viewed_at DESC`,
    [rowId, lang, userBU],
  );
  return rows.map(({ fn, mn, ln, ...rest }) => ({ ...rest, name: formatDisplayName(ln, fn, mn) }));
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
