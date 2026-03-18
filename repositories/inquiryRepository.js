/**
 * Inquiry Repository
 *
 * Raw SQL for v4.inquiry_tbl and related read helpers.
 * Write functions that participate in a transaction accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

const db = (client) => client ?? getPool();

// ─── Search (dynamic query) ───────────────────────────────────────────────────

export const searchInquiries = async ({ lang, businessUnit, userId, userRole, filters }) => {
  const { status, type, company_id, assigned_to, high_pri, ticket_id } = filters;

  let query = `
    SELECT
      i.*,
      COALESCE(NULLIF(c.company_name->>$1, ''), NULLIF(c.company_name->>'en', ''), 'N/A') AS company_name_text,
      COALESCE(iss.descr->>$1, iss.descr->>'en', 'General Inquiry') AS type_name,
      u_assign.first_name AS assign_fn, u_assign.middle_name AS assign_mn, u_assign.last_name AS assign_ln,
      u_owner.first_name AS owner_fn, u_owner.middle_name AS owner_mn, u_owner.last_name AS owner_ln,
      u_open.first_name AS open_fn, u_open.middle_name AS open_mn, u_open.last_name AS open_ln,
      u_upd.first_name AS upd_fn, u_upd.middle_name AS upd_mn, u_upd.last_name AS upd_ln,
      COALESCE(vl.descr->>$1, vl.descr->>'en', vi.visa_type) AS visa_type,
      (SELECT JSON_AGG(JSON_BUILD_OBJECT('fn', first_name, 'mn', middle_name, 'ln', last_name))
       FROM v4.user_profile_tbl
       WHERE user_id = ANY(i.watcher)) AS watcher_name_parts,
      (SELECT COUNT(*)
       FROM v4.shared_comments
       WHERE relation_type = 'inquiries' AND relation_id = i.ticket_id) AS comment_count,
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
          WHERE relation_type = 'inquiries' AND relation_id = i.ticket_id::text
        ), '[]'::json
      ) AS attachments
    FROM v4.inquiry_tbl i
    LEFT JOIN v4.company_tbl c ON i.company = c.company_id
    LEFT JOIN v4.issue_tbl iss ON i.type = iss.code AND i.business_unit = iss.business_unit
    LEFT JOIN v4.user_profile_tbl u_assign ON i.assigned_to = u_assign.user_id
    LEFT JOIN v4.user_profile_tbl u_owner ON i.owner_id = u_owner.user_id
    LEFT JOIN v4.user_profile_tbl u_open ON i.opened_by = u_open.user_id
    LEFT JOIN v4.user_profile_tbl u_upd ON i.last_updated_by = u_upd.user_id
    LEFT JOIN v4.user_visa_info_tbl vi ON i.owner_id = vi.user_id
    LEFT JOIN v4.visa_list_tbl vl ON vi.visa_type = vl.code AND vl.business_unit = i.business_unit
    WHERE i.business_unit = $2
  `;

  const values = [lang, businessUnit];

  if (userRole !== "OFFICER") {
    values.push(userId);
    query += ` AND i.owner_id = $${values.length}::uuid`;
  }

  if (ticket_id) {
    values.push(ticket_id);
    query += ` AND i.ticket_id = $${values.length}`;
  } else {
    if (status && status !== "All") {
      const statuses = status.split(",").map((s) => s.trim());
      values.push(statuses);
      query += ` AND i.status = ANY($${values.length}::text[])`;
    } else {
      query += ` AND i.status NOT IN ('CLOSED')`;
    }

    if (type && type !== "All") {
      values.push(type);
      query += ` AND i.type = $${values.length}`;
    }

    if (company_id && company_id !== "null") {
      values.push(company_id);
      query += ` AND i.company = $${values.length}`;
    }

    if (assigned_to && assigned_to !== "null") {
      values.push(assigned_to);
      query += ` AND i.assigned_to = $${values.length}::uuid`;
    }

    if (high_pri === "true" || high_pri === true) {
      query += ` AND i.high_pri = true`;
    }
  }

  query += ` ORDER BY i.last_update_dttm DESC`;

  const { rows } = await getPool().query(query, values);
  return rows.map((r) => {
    const { assign_fn, assign_mn, assign_ln, owner_fn, owner_mn, owner_ln,
            open_fn, open_mn, open_ln, upd_fn, upd_mn, upd_ln,
            watcher_name_parts, ...rest } = r;
    const watchers = Array.isArray(watcher_name_parts)
      ? watcher_name_parts.map((w) => formatDisplayName(w.ln, w.fn, w.mn)).join(", ")
      : null;
    return {
      ...rest,
      assigned_to_name: assign_ln ? formatDisplayName(assign_ln, assign_fn, assign_mn) : null,
      owner_name: owner_ln ? formatDisplayName(owner_ln, owner_fn, owner_mn) : null,
      opened_by_name: open_ln ? formatDisplayName(open_ln, open_fn, open_mn) : null,
      last_updated_by_name: upd_ln ? formatDisplayName(upd_ln, upd_fn, upd_mn) : null,
      watcher_names: watchers,
    };
  });
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const insertInquiry = async (fields) => {
  const {
    userBU, company, title, description, occur_date,
    type, high_pri, watcher, opened_by, owner_id, assigned_to,
  } = fields;

  const { rows } = await getPool().query(
    `INSERT INTO v4.inquiry_tbl (
       business_unit, company, title, description,
       occur_date, type, high_pri, watcher,
       opened_by, owner_id, assigned_to,
       status, open_dt, last_updated_by, last_update_dttm
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8::uuid[],
       $9::uuid, $10::uuid, $11::uuid,
       'NEW', CURRENT_DATE, $9::uuid, NOW()
     ) RETURNING *`,
    [
      userBU,
      company && company !== "" ? company : null,
      title,
      description,
      occur_date,
      type,
      high_pri,
      Array.isArray(watcher) ? watcher.filter((id) => id !== "") : [],
      opened_by,
      owner_id,
      assigned_to || null,
    ],
  );
  return rows[0];
};

// ─── Read ─────────────────────────────────────────────────────────────────────

export const findInquiryById = async (ticketId, businessUnit, client) => {
  const { rowCount } = await db(client).query(
    `SELECT ticket_id FROM v4.inquiry_tbl
     WHERE ticket_id = $1::integer AND business_unit = $2`,
    [ticketId, businessUnit],
  );
  return rowCount;
};

export const findOldInquiry = async (ticketId, businessUnit) => {
  const { rows } = await getPool().query(
    "SELECT * FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
    [ticketId, businessUnit],
  );
  return rows[0] ?? null;
};

/** Returns the display name for a user, or "Someone" if not found. */
export const findUserName = async (userId, client) => {
  const { rows } = await db(client).query(
    `SELECT first_name, middle_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) return "Someone";
  return formatDisplayName(rows[0].last_name, rows[0].first_name, rows[0].middle_name);
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateInquiry = async (fields) => {
  const {
    status, assigned_to, resolution, description, high_pri,
    watcher, closed_dt, userId, ticketId, title, type,
    occur_date, userBU,
  } = fields;

  const { rows } = await getPool().query(
    `UPDATE v4.inquiry_tbl
     SET status = $1, assigned_to = $2::uuid, resolution = $3, description = $4,
         high_pri = $5, watcher = $6::uuid[], closed_dt = $7, last_updated_by = $8::uuid,
         last_update_dttm = NOW(), title = $10, type = $11, occur_date = $12
     WHERE ticket_id = $9 AND business_unit = $13
     RETURNING *`,
    [
      status, assigned_to, resolution, description, high_pri,
      watcher, closed_dt, userId, ticketId, title, type,
      occur_date, userBU,
    ],
  );
  return rows[0] ?? null;
};

// ─── Delete (cascade — all steps in caller's transaction) ────────────────────

export const findInquiryAttachmentKeys = async (ticketId, businessUnit, client) => {
  const { rows } = await db(client).query(
    `SELECT s3_key FROM v4.shared_attachments
     WHERE relation_id = $1 AND relation_type = 'inquiries' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  return rows;
};

export const cascadeDeleteInquiry = async (ticketId, businessUnit, client) => {
  await db(client).query(
    `DELETE FROM v4.shared_attachments
     WHERE relation_id = $1 AND relation_type = 'inquiries' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.shared_comments
     WHERE relation_id = $1 AND relation_type = 'inquiries' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.notification_history_tbl
     WHERE relation_id = $1 AND relation_type = 'inquiries' AND business_unit = $2`,
    [String(ticketId), businessUnit],
  );
  await db(client).query(
    `DELETE FROM v4.inquiry_tbl
     WHERE ticket_id = $1::integer AND business_unit = $2`,
    [ticketId, businessUnit],
  );
};

// ─── Lookups ──────────────────────────────────────────────────────────────────

export const findIssues = async (lang, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT
       code AS value,
       COALESCE(descr->>$1, descr->>'en', code) AS label,
       active
     FROM v4.issue_tbl
     WHERE business_unit = $2 AND active = true
     ORDER BY sort_order ASC`,
    [lang, businessUnit],
  );
  return rows;
};

export const findOfficersByBU = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT
       p.user_id AS value,
       p.first_name AS fn, p.middle_name AS mn, p.last_name AS ln
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON p.user_id = a.id
     WHERE a.business_unit = $1
       AND p.user_type = 'OFFICER'
       AND a.is_active = true
       AND EXISTS (
         SELECT 1 FROM v4.user_roles r
         WHERE r.user_id = a.id
           AND r.role_name = 'inquiries_write'
       )
     ORDER BY p.first_name ASC`,
    [businessUnit],
  );
  return rows.map(({ fn, mn, ln, ...rest }) => ({ ...rest, label: formatDisplayName(ln, fn, mn) }));
};
