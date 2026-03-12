/**
 * Feed (Announcement) Repository
 *
 * Raw SQL for v4.announcement_tbl, announcement_views, and related helpers.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── Posters (distinct creators) ─────────────────────────────────────────────

export const findPosters = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT
       a.created_by AS value,
       p.first_name || ' ' || p.last_name AS label
     FROM v4.announcement_tbl a
     JOIN v4.user_profile_tbl p ON a.created_by = p.user_id
     WHERE a.business_unit = $1
     ORDER BY label ASC`,
    [businessUnit],
  );
  return rows;
};

// ─── Fetch announcements (dynamic query) ──────────────────────────────────────

export const findAnnouncements = async ({ lang, userId, company_filter, userBU, isOfficer, isManagement }) => {
  let query = `
    SELECT
      a.row_id,
      a.business_unit,
      a.company AS company_ids,
      a.batch_no,
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
      u.first_name || ' ' || u.last_name AS created_by_name,
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
    // Officers see everything in the BU — no extra company filter
  } else if (company_filter) {
    values.push(company_filter);
    query += ` AND ($${values.length} = ANY(a.company::uuid[]) OR a.company IS NULL OR cardinality(a.company) = 0)`;
  } else {
    query += ` AND (a.company IS NULL OR cardinality(a.company) = 0)`;
  }

  if (userBU) {
    values.push(userBU);
    query += ` AND a.business_unit = $${values.length}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  const { rows } = await getPool().query(query, values);
  return rows;
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const insertAnnouncement = async (fields) => {
  const { userBU, company, batch_no, title, content_text, date_from, date_to, active, comments_on, userId } = fields;
  const { rows } = await getPool().query(
    `INSERT INTO v4.announcement_tbl (
       business_unit, company, batch_no, title, content_text,
       date_from, date_to, active, comments_on,
       created_by, created_at, last_updated_by, last_updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid, NOW(), $10::uuid, NOW())
     RETURNING *`,
    [userBU, company, batch_no || null, title, content_text, date_from, date_to, active, comments_on, userId],
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
  const { rows } = await db(client).query(
    `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1::uuid`,
    [userId],
  );
  if (!rows[0]) return "Someone";
  return `${rows[0].first_name} ${rows[0].last_name}`;
};

/**
 * Returns user_id strings for all active BU users (excluding the poster),
 * optionally filtered by company array.
 */
export const findRecipientIds = async (userBU, excludeUserId, company) => {
  let query = `
    SELECT DISTINCT a.id::text AS user_id
    FROM v4.user_account_tbl a
    JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE a.business_unit = $1::text
      AND a.is_active = true
      AND a.id != $2::uuid
  `;
  const values = [userBU, excludeUserId];

  if (company && Array.isArray(company) && company.length > 0) {
    values.push(company);
    query += ` AND (p.company::uuid = ANY($${values.length}::uuid[]) OR p.company IS NULL)`;
  }

  const { rows } = await getPool().query(query, values);
  return rows.map((r) => r.user_id);
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateAnnouncement = async (fields) => {
  const { company, batch_no, title, content_text, date_from, date_to, active, comments_on, userId, rowId, userBU } = fields;
  const { rows } = await getPool().query(
    `UPDATE v4.announcement_tbl
     SET company = $1, batch_no = $2, title = $3,
         content_text = $4, date_from = $5, date_to = $6,
         active = $7, comments_on = $8,
         last_updated_by = $9::uuid,
         last_updated_at = NOW()
     WHERE row_id = $10::integer AND business_unit = $11
     RETURNING *`,
    [company, batch_no || null, title, content_text, date_from, date_to, active, comments_on, userId, rowId, userBU],
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
export const findUsersForReactions = async (userIds) => {
  const { rows } = await getPool().query(
    `SELECT a.id, p.first_name || ' ' || p.last_name AS name, p.company
     FROM v4.user_account_tbl a
     LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
     WHERE a.id = ANY($1::uuid[])`,
    [userIds],
  );
  return rows;
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

export const countAudience = async (businessUnit, company, batch_no) => {
  let query = `
    SELECT COUNT(DISTINCT a.id) AS count
    FROM v4.user_account_tbl a
    INNER JOIN v4.user_profile_tbl p ON a.id = p.user_id
    WHERE a.business_unit = $1 AND a.is_active = true
  `;
  const values = [businessUnit];

  if (company && Array.isArray(company) && company.length > 0) {
    values.push(company);
    query += ` AND p.company::uuid = ANY($${values.length}::uuid[])`;
  }

  if (batch_no && company && company.length === 1) {
    values.push(batch_no);
    query += ` AND p.batch_no = $${values.length}`;
  }

  const { rows } = await getPool().query(query, values);
  return parseInt(rows[0].count) || 0;
};

// ─── Views ────────────────────────────────────────────────────────────────────

export const upsertAnnouncementView = async (rowId, userId, userBU) => {
  await getPool().query(
    `INSERT INTO v4.announcement_views (announcement_id, user_id, business_unit)
     VALUES ($1::integer, $2::uuid, $3)
     ON CONFLICT (announcement_id, user_id)
     DO UPDATE SET viewed_at = NOW()`,
    [rowId, userId, userBU],
  );
};

export const findViewers = async (rowId, lang, userBU) => {
  const { rows } = await getPool().query(
    `SELECT
       v.user_id AS id,
       p.first_name || ' ' || p.last_name AS name,
       COALESCE(c.company_name->>$2, c.company_name->>'en') AS company,
       v.viewed_at
     FROM v4.announcement_views v
     JOIN v4.user_profile_tbl p ON v.user_id = p.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
     JOIN v4.announcement_tbl a ON v.announcement_id = a.row_id
     WHERE v.announcement_id = $1::integer
       AND a.business_unit = $3
     ORDER BY v.viewed_at DESC`,
    [rowId, lang, userBU],
  );
  return rows;
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
