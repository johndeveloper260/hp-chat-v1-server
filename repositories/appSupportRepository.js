/**
 * App Support Repository
 *
 * Raw SQL for v4.app_support_ticket_tbl and related helpers.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

const db = (client) => client ?? getPool();

// ─── Search ───────────────────────────────────────────────────────────────────

export const searchTickets = async ({ businessUnit, userId, isSupportUser, isPlatformAdmin, filters }) => {
  const { status, severity, category, assigned_to, company_id, ticket_id } = filters;

  let query = `
    SELECT
      t.*,
      COALESCE(NULLIF(c.company_name->>$1, ''), NULLIF(c.company_name->>'en', ''), 'N/A') AS company_name_text,
      u_created.first_name  AS created_fn, u_created.middle_name AS created_mn, u_created.last_name AS created_ln,
      u_assign.first_name   AS assign_fn,  u_assign.middle_name  AS assign_mn,  u_assign.last_name  AS assign_ln,
      u_upd.first_name      AS upd_fn,     u_upd.middle_name     AS upd_mn,     u_upd.last_name     AS upd_ln,
      a_created.email       AS created_by_email,
      (SELECT COUNT(*)
       FROM v4.shared_comments
       WHERE relation_type = 'app_support' AND relation_id = t.ticket_id) AS comment_count,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'attachment_id', attachment_id,
              's3_key', s3_key,
              's3_bucket', s3_bucket,
              'name', display_name,
              'type', file_type
            )
          )
          FROM v4.shared_attachments
          WHERE relation_type = 'app_support' AND relation_id = t.ticket_id::text
        ), '[]'::json
      ) AS attachments
    FROM v4.app_support_ticket_tbl t
    LEFT JOIN v4.company_tbl c       ON t.company_id = c.company_id::text
    LEFT JOIN v4.user_profile_tbl u_created ON t.created_by      = u_created.user_id
    LEFT JOIN v4.user_profile_tbl u_assign  ON t.assigned_to     = u_assign.user_id
    LEFT JOIN v4.user_profile_tbl u_upd     ON t.last_updated_by = u_upd.user_id
    LEFT JOIN v4.user_account_tbl a_created ON t.created_by      = a_created.id
    WHERE 1=1
  `;

  // Platform admins see all BUs; everyone else is scoped to their own BU
  const values = ["en"];
  if (!isPlatformAdmin) {
    values.push(businessUnit);
    query += ` AND t.business_unit = $${values.length}`;
  }

  if (!isSupportUser && !isPlatformAdmin) {
    values.push(userId);
    query += ` AND t.created_by = $${values.length}::uuid`;
  }

  if (ticket_id) {
    values.push(ticket_id);
    query += ` AND t.ticket_id = $${values.length}`;
  } else {
    if (status && status !== "All") {
      const statuses = status.split(",").map((s) => s.trim());
      values.push(statuses);
      query += ` AND t.status = ANY($${values.length}::text[])`;
    } else {
      query += ` AND t.status NOT IN ('CLOSED')`;
    }

    if (severity && severity !== "All") {
      values.push(severity);
      query += ` AND t.severity = $${values.length}`;
    }

    if (category && category !== "All") {
      values.push(category);
      query += ` AND t.category = $${values.length}`;
    }

    if (assigned_to && assigned_to !== "null") {
      values.push(assigned_to);
      query += ` AND t.assigned_to = $${values.length}::uuid`;
    }

    if (company_id && company_id !== "null") {
      values.push(company_id);
      query += ` AND t.company_id = $${values.length}`;
    }
  }

  query += ` ORDER BY t.updated_at DESC`;

  const { rows } = await getPool().query(query, values);
  return rows.map((r) => {
    const { created_fn, created_mn, created_ln, assign_fn, assign_mn, assign_ln,
            upd_fn, upd_mn, upd_ln, ...rest } = r;
    return {
      ...rest,
      created_by_name:      (created_fn || created_ln) ? formatDisplayName(created_ln, created_fn, created_mn) : null,
      assigned_to_name:     (assign_fn  || assign_ln)  ? formatDisplayName(assign_ln,  assign_fn,  assign_mn)  : null,
      last_updated_by_name: (upd_fn     || upd_ln)     ? formatDisplayName(upd_ln,     upd_fn,     upd_mn)     : null,
    };
  });
};

// ─── Get single ticket ────────────────────────────────────────────────────────

export const findTicketById = async (ticketId, businessUnit, client) => {
  const buClause = businessUnit ? ` AND business_unit = $2` : "";
  const params   = businessUnit ? [ticketId, businessUnit] : [ticketId];
  const { rows, rowCount } = await db(client).query(
    `SELECT * FROM v4.app_support_ticket_tbl WHERE ticket_id = $1::integer${buClause}`,
    params,
  );
  return { row: rows[0] ?? null, rowCount };
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const insertTicket = async (fields) => {
  const {
    businessUnit, userId, title, description, category, severity,
    source_page, browser_info, app_version, company_id,
  } = fields;

  const { rows } = await getPool().query(
    `INSERT INTO v4.app_support_ticket_tbl (
       business_unit, created_by, last_updated_by,
       title, description, category, severity,
       source_page, browser_info, app_version, company_id,
       status
     ) VALUES (
       $1, $2::uuid, $2::uuid,
       $3, $4, $5, $6,
       $7, $8, $9, $10,
       'NEW'
     ) RETURNING *`,
    [
      businessUnit, userId,
      title, description ?? null, category ?? "OTHER", severity ?? "NORMAL",
      source_page ?? null, browser_info ?? null, app_version ?? null,
      company_id ?? null,
    ],
  );
  return rows[0];
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateTicket = async (fields) => {
  const {
    ticketId, businessUnit, userId,
    title, description, category, severity, source_page, browser_info, app_version,
    status, assigned_to, resolution, closed_at,
  } = fields;

  const { rows } = await getPool().query(
    `UPDATE v4.app_support_ticket_tbl
     SET
       title         = COALESCE($3,  title),
       description   = COALESCE($4,  description),
       category      = COALESCE($5,  category),
       severity      = COALESCE($6,  severity),
       source_page   = COALESCE($7,  source_page),
       browser_info  = COALESCE($8,  browser_info),
       app_version   = COALESCE($9,  app_version),
       status        = COALESCE($10, status),
       assigned_to   = COALESCE($11::uuid, assigned_to),
       resolution    = COALESCE($12, resolution),
       closed_at     = $13,
       last_updated_by  = $14::uuid
     WHERE ticket_id = $1::integer AND ($2::text IS NULL OR business_unit = $2)
     RETURNING *`,
    [
      ticketId, businessUnit ?? null,
      title ?? null, description ?? null, category ?? null, severity ?? null,
      source_page ?? null, browser_info ?? null, app_version ?? null,
      status ?? null, assigned_to ?? null, resolution ?? null, closed_at ?? null,
      userId,
    ],
  );
  return rows[0] ?? null;
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const findTicketAttachmentKeys = async (ticketId, businessUnit, client) => {
  const { rows } = await db(client).query(
    `SELECT s3_key FROM v4.shared_attachments
     WHERE relation_id = $1 AND relation_type = 'app_support' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  return rows;
};

export const cascadeDeleteTicket = async (ticketId, businessUnit, client) => {
  await db(client).query(
    `DELETE FROM v4.shared_attachments
     WHERE relation_id = $1 AND relation_type = 'app_support' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.shared_comments
     WHERE relation_id = $1 AND relation_type = 'app_support' AND business_unit = $2`,
    [ticketId, businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.notification_history_tbl
     WHERE relation_id = $1 AND relation_type = 'app_support' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.app_support_ticket_tbl
     WHERE ticket_id = $1::integer AND business_unit = $2`,
    [ticketId, businessUnit],
  );
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const findUserName = async (userId, client) => {
  const { rows } = await db(client).query(
    `SELECT first_name, middle_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) return "Someone";
  return formatDisplayName(rows[0].last_name, rows[0].first_name, rows[0].middle_name);
};

export const findSupportUsersForBU = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT r.user_id
     FROM v4.user_roles r
     JOIN v4.user_account_tbl a ON a.id = r.user_id AND a.business_unit = $1 AND a.is_active = true
     WHERE r.role_name IN ('app_support_write', 'app_support_admin')`,
    [businessUnit],
  );
  return rows.map((r) => r.user_id);
};

export const findSupportAgents = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT
       p.user_id AS value,
       p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON p.user_id = a.id
     JOIN v4.user_roles r ON r.user_id = a.id
     WHERE a.business_unit = $1
       AND a.is_active = true
       AND r.role_name IN ('app_support_write', 'app_support_admin')
     ORDER BY p.first_name ASC`,
    [businessUnit],
  );
  return rows.map(({ fn, mn, ln, ...rest }) => ({ ...rest, label: formatDisplayName(ln, fn, mn) }));
};
