/**
 * Return Home Repository
 *
 * All raw SQL for v4.return_home_tbl plus related attachment and
 * cascade-delete helpers.
 * Every delete helper accepts a `client` for transaction support.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];

// ── Search ────────────────────────────────────────────────────────────────────

export const searchReturnHome = async (
  businessUnit,
  userId,
  userRole,
  lang,
  filters = {},
) => {
  const {
    status,
    is_resignation,
    is_paid_leave,
    company,
    user_name,
    flight_date_from,
    flight_date_to,
  } = filters;

  const values = [lang, businessUnit];
  let query = `
    SELECT
      r.*,
      TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
      p.company AS user_company_id,
      COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
      v.visa_type, v.joining_date, v.visa_expiry_date,
      COALESCE(vl.descr->>$1, vl.descr->>'en', (SELECT value FROM jsonb_each_text(vl.descr) LIMIT 1)) AS visa_type_descr,
      (
        SELECT COUNT(*)
        FROM v4.shared_comments
        WHERE relation_type = 'return_home' AND relation_id = r.id
      ) AS comment_count,
      COALESCE(
        (
          SELECT json_agg(json_build_object(
            'attachment_id', attachment_id,
            'name', display_name,
            'type', file_type
          ))
          FROM v4.shared_attachments
          WHERE relation_type = 'return_home' AND relation_id = r.id::text
        ),
        '[]'
      ) AS attachments
    FROM v4.return_home_tbl r
    LEFT JOIN v4.user_profile_tbl     p ON r.user_id = p.user_id
    LEFT JOIN v4.company_tbl          c ON p.company = c.company_id::text
    LEFT JOIN v4.user_visa_info_tbl   v ON r.user_id = v.user_id
    LEFT JOIN v4.visa_list_tbl       vl ON v.visa_type = vl.code AND r.business_unit = vl.business_unit
    WHERE r.business_unit = $2
  `;

  if (is_resignation !== undefined) {
    values.push(is_resignation);
    query += ` AND r.is_resignation = $${values.length}`;
  }
  if (is_paid_leave !== undefined) {
    values.push(is_paid_leave);
    query += ` AND r.is_paid_leave = $${values.length}`;
  }

  // Non-elevated users see only their own records
  if (!ELEVATED_ROLES.includes(userRole)) {
    values.push(userId);
    query += ` AND r.user_id::uuid = $${values.length}::uuid`;
  }

  if (company) {
    values.push(company);
    query += ` AND p.company = $${values.length}`;
  }
  if (user_name) {
    values.push(`%${user_name}%`);
    query += ` AND (p.first_name ILIKE $${values.length} OR p.last_name ILIKE $${values.length})`;
  }
  if (flight_date_from) {
    values.push(flight_date_from);
    query += ` AND r.flight_date >= $${values.length}::date`;
  }
  if (flight_date_to) {
    values.push(flight_date_to);
    query += ` AND r.flight_date <= $${values.length}::date`;
  }

  // Dynamic status filter — parameterised to prevent injection
  if (status && status !== "All") {
    if (status === "Upcoming") {
      query += ` AND r.flight_date > CURRENT_DATE`;
    } else if (status === "Out of Country") {
      query += ` AND r.flight_date <= CURRENT_DATE AND (r.return_date IS NULL OR r.return_date >= CURRENT_DATE)`;
    } else if (status === "Returned") {
      query += ` AND r.return_date < CURRENT_DATE`;
    } else {
      values.push(status);
      query += ` AND r.status = $${values.length}`;
    }
  }

  query += ` ORDER BY r.created_at DESC`;
  const { rows } = await getPool().query(query, values);
  return rows;
};

// ── Create ────────────────────────────────────────────────────────────────────

export const createReturnHome = async (data) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.return_home_tbl (
       user_id, business_unit, flight_date, return_date,
       route_origin, route_destination, ticket_type,
       lumpsum_applying, details, tio_jo,
       is_resignation, is_paid_leave, status,
       resign_date, leave_days, mode_of_payment, payment_amount, currency,
       payment_settled, created_by, updated_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20)
     RETURNING id`,
    [
      data.targetUserId,
      data.businessUnit,
      data.flight_date        || null,
      data.return_date        || null,
      data.route_origin       || null,
      data.route_destination  || null,
      data.ticket_type        || null,
      data.lumpsum_applying,
      data.details            || null,
      data.tio_jo             || null,
      data.is_resignation     ?? false,
      data.is_paid_leave      ?? false,
      data.status             || "Draft",
      data.resign_date        || null,
      data.leave_days != null ? Number(data.leave_days) : null,
      data.mode_of_payment    || null,
      data.payment_amount != null ? Number(data.payment_amount) : null,
      data.currency           || "JPY",
      data.payment_settled    ?? false,
      data.creatorId,
    ],
  );
  return rows[0];
};

// ── Get by ID ─────────────────────────────────────────────────────────────────

export const findReturnHomeById = async (id, businessUnit, lang) => {
  const { rows } = await getPool().query(
    `SELECT
       r.*,
       TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
       p.first_name, p.last_name, p.company AS user_company_id,
       COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
       v.visa_type, v.joining_date, v.visa_expiry_date,
       COALESCE(vl.descr->>$1, vl.descr->>'en', (SELECT value FROM jsonb_each_text(vl.descr) LIMIT 1)) AS visa_type_descr
     FROM v4.return_home_tbl r
     LEFT JOIN v4.user_profile_tbl   p ON r.user_id = p.user_id
     LEFT JOIN v4.company_tbl        c ON p.company = c.company_id::text
     LEFT JOIN v4.user_visa_info_tbl v ON r.user_id = v.user_id
     LEFT JOIN v4.visa_list_tbl     vl ON v.visa_type = vl.code AND r.business_unit = vl.business_unit
     WHERE r.id = $2 AND r.business_unit = $3`,
    [lang, id, businessUnit],
  );
  return rows[0] ?? null;
};

export const findAttachments = async (id, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT attachment_id, display_name AS name, file_type AS type, s3_key, s3_bucket
     FROM v4.shared_attachments
     WHERE relation_type = 'return_home' AND relation_id = $1::text AND business_unit = $2`,
    [id, businessUnit],
  );
  return rows;
};

// ── Update ────────────────────────────────────────────────────────────────────

/** Lightweight pre-update read — returns { user_id, status } or null. */
export const findReturnHomeForNotify = async (id, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT user_id, status FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2`,
    [id, businessUnit],
  );
  return rows[0] ?? null;
};

export const updateReturnHome = async (id, businessUnit, data, safeUserId) => {
  const common = [
    data.flight_date        || null,
    data.return_date        || null,
    data.route_origin       || null,
    data.route_destination  || null,
    data.ticket_type        || null,
    data.lumpsum_applying,
    data.tio_jo             || null,
    data.details            || null,
    data.is_resignation     ?? false,
    data.is_paid_leave      ?? false,
    data.status             || null,
    data.resign_date        || null,
    data.leave_days != null ? Number(data.leave_days) : null,
    data.mode_of_payment    || null,
    data.payment_amount != null ? Number(data.payment_amount) : null,
    data.currency           || "JPY",
    data.updatedBy,
    data.payment_settled    ?? false,
  ];

  const sql = safeUserId
    ? `UPDATE v4.return_home_tbl
       SET flight_date=$1, return_date=$2, route_origin=$3, route_destination=$4,
           ticket_type=$5, lumpsum_applying=$6, tio_jo=$7, details=$8,
           is_resignation=$9, is_paid_leave=$10, status=$11, resign_date=$12,
           leave_days=$13, mode_of_payment=$14, payment_amount=$15, currency=$16,
           updated_by=$17, updated_at=NOW(), payment_settled=$18, user_id=$19
       WHERE id=$20 AND business_unit=$21 RETURNING *`
    : `UPDATE v4.return_home_tbl
       SET flight_date=$1, return_date=$2, route_origin=$3, route_destination=$4,
           ticket_type=$5, lumpsum_applying=$6, tio_jo=$7, details=$8,
           is_resignation=$9, is_paid_leave=$10, status=$11, resign_date=$12,
           leave_days=$13, mode_of_payment=$14, payment_amount=$15, currency=$16,
           updated_by=$17, updated_at=NOW(), payment_settled=$18
       WHERE id=$19 AND business_unit=$20 RETURNING *`;

  const values = safeUserId
    ? [...common, safeUserId, id, businessUnit]
    : [...common, id, businessUnit];

  const { rows } = await getPool().query(sql, values);
  return rows[0] ?? null;
};

// ── Approve ───────────────────────────────────────────────────────────────────

export const approveReturnHome = async (
  id,
  businessUnit,
  status,
  approverRemarks,
  officerId,
) => {
  const { rows } = await getPool().query(
    `UPDATE v4.return_home_tbl
     SET status = $1, approver_remarks = $2, approved_by = $3,
         approved_at = NOW(), updated_at = NOW(), updated_by = $3
     WHERE id = $4 AND business_unit = $5
     RETURNING user_id`,
    [status, approverRemarks, officerId, id, businessUnit],
  );
  return rows[0] ?? null;
};

/** Returns the display name for a user, or "Someone" if not found. */
export const findUserName = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
    [userId],
  );
  if (!rows[0]) return "Someone";
  return `${rows[0].first_name} ${rows[0].last_name}`;
};

/** Returns an array of user_ids for active OFFICERS in the BU with flight_read or flight_write role. */
export const findOfficersWithFlightRoles = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT DISTINCT a.id AS user_id
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON p.user_id = a.id
     WHERE a.business_unit = $1
       AND p.user_type = 'OFFICER'
       AND a.is_active = true
       AND EXISTS (
         SELECT 1 FROM v4.user_roles r
         WHERE r.user_id = a.id
           AND r.role_name IN ('flight_read', 'flight_write')
       )`,
    [businessUnit],
  );
  return rows.map((r) => r.user_id);
};

// ── Delete (transaction-scoped) ───────────────────────────────────────────────

export const checkExistsForDelete = async (id, businessUnit, client) => {
  const { rowCount } = await db(client).query(
    "SELECT id FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2",
    [id, businessUnit],
  );
  return rowCount > 0;
};

/** Returns rows with { s3_key, s3_bucket } for physical S3 cleanup. */
export const findAttachmentKeys = async (id, businessUnit, client) => {
  const { rows } = await db(client).query(
    `SELECT s3_key, s3_bucket FROM v4.shared_attachments
     WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2`,
    [String(id), businessUnit],
  );
  return rows;
};

export const deleteRelated = async (id, businessUnit, client) => {
  const sid = String(id);
  await db(client).query(
    "DELETE FROM v4.shared_comments WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2",
    [sid, businessUnit],
  );
  await db(client).query(
    "DELETE FROM v4.shared_attachments WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2",
    [sid, businessUnit],
  );
  await db(client).query(
    "DELETE FROM v4.notification_history_tbl WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2",
    [sid, businessUnit],
  );
};

export const deleteRecord = async (id, businessUnit, client) => {
  await db(client).query(
    "DELETE FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2",
    [id, businessUnit],
  );
};
