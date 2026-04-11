/**
 * Bulk User Repository
 *
 * Raw SQL for bulk export and bulk update of user_profile_tbl + user_visa_info_tbl.
 * Write functions accept an optional `client` for transaction support.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Export ────────────────────────────────────────────────────────────────────

/**
 * Returns users for a given business unit with optional filters.
 * Filters: country, sending_org, company, batch_no (all case-insensitive partial match).
 * Ordered by last_name ASC, first_name ASC.
 */
export const getUsersForExport = async (businessUnit, filters = {}) => {
  const values = [businessUnit];
  const parts  = [];

  if (filters.country?.length) {
    values.push(filters.country);
    parts.push(`AND p.country = ANY($${values.length})`);
  }
  if (filters.sending_org) {
    values.push(filters.sending_org);
    parts.push(`AND p.sending_org = $${values.length}`);
  }
  if (filters.company?.length) {
    values.push(filters.company);
    parts.push(`AND p.company = ANY($${values.length})`);
  }
  if (filters.batch_no) {
    values.push(filters.batch_no);
    parts.push(`AND p.batch_no = $${values.length}`);
  }

  const { rows } = await getPool().query(
    `SELECT
       p.user_id,
       p.last_name,
       p.first_name,
       p.middle_name,
       p.sending_org,
       c.company_code,
       p.batch_no,
       p.position,
       p.company_joining_date,
       v.visa_type,
       v.visa_number,
       v.visa_issue_date,
       v.visa_expiry_date,
       v.passport_no,
       v.passport_name,
       v.passport_expiry,
       v.passport_issuing_country,
       v.issuing_authority,
       v.joining_date,
       v.assignment_start_date,
       p.city,
       p.country,
       p.state_province,
       p.street_address,
       p.postal_code,
       p.birthdate,
       p.gender,
       p.phone_number,
       p.emergency_contact_name,
       p.emergency_contact_number,
       p.emergency_email,
       p.emergency_contact_address
     FROM v4.user_profile_tbl p
     JOIN  v4.user_account_tbl      a ON a.id      = p.user_id
     LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = p.user_id
     LEFT JOIN v4.company_tbl        c ON p.company::uuid = c.company_id
     WHERE p.business_unit = $1
     AND UPPER(p.user_type) = 'USER'
     AND a.is_active = true
     ${parts.join(" ")}
     ORDER BY p.last_name ASC, p.first_name ASC`,
    values,
  );
  return rows;
};

// ── Bulk update ───────────────────────────────────────────────────────────────

const n = (v) => (v === "" || v === undefined ? null : v);

/**
 * Updates profile fields for a single user.
 * Returns rowCount (0 = user not found in this BU).
 */
export const bulkUpdateProfile = async (userId, fields, businessUnit, client) => {
  const { rowCount } = await db(client).query(
    `UPDATE v4.user_profile_tbl SET
       last_name                 = $1,
       first_name                = $2,
       middle_name               = $3,
       sending_org               = $4,
       company                   = $5,
       batch_no                  = $6,
       position                  = $7,
       company_joining_date      = $8,
       city                      = $9,
       country                   = $10,
       state_province            = $11,
       street_address            = $12,
       postal_code               = $13,
       birthdate                 = $14,
       gender                    = $15,
       phone_number              = $16,
       emergency_contact_name    = $17,
       emergency_contact_number  = $18,
       emergency_email           = $19,
       emergency_contact_address = $20,
       updated_at                = NOW()
     WHERE user_id = $21 AND business_unit = $22`,
    [
      n(fields.last_name),
      n(fields.first_name),
      n(fields.middle_name),
      n(fields.sending_org),
      n(fields.company),
      n(fields.batch_no),
      n(fields.position),
      n(fields.company_joining_date),
      n(fields.city),
      n(fields.country),
      n(fields.state_province),
      n(fields.street_address),
      n(fields.postal_code),
      n(fields.birthdate),
      n(fields.gender),
      n(fields.phone_number),
      n(fields.emergency_contact_name),
      n(fields.emergency_contact_number),
      n(fields.emergency_email),
      n(fields.emergency_contact_address),
      userId,
      businessUnit,
    ],
  );
  return rowCount;
};

/**
 * Updates visa fields for a single user.
 * Returns rowCount (0 = no visa record found for this user).
 */
export const bulkUpdateVisa = async (userId, fields, client) => {
  const { rowCount } = await db(client).query(
    `UPDATE v4.user_visa_info_tbl SET
       visa_type                = $1,
       visa_number              = $2,
       visa_issue_date          = $3,
       visa_expiry_date         = $4,
       passport_no              = $5,
       passport_name            = $6,
       passport_expiry          = $7,
       passport_issuing_country = $8,
       issuing_authority        = $9,
       joining_date             = $10,
       assignment_start_date    = $11,
       updated_at               = NOW()
     WHERE user_id = $12`,
    [
      n(fields.visa_type),
      n(fields.visa_number),
      n(fields.visa_issue_date),
      n(fields.visa_expiry_date),
      n(fields.passport_no),
      n(fields.passport_name),
      n(fields.passport_expiry),
      n(fields.passport_issuing_country),
      n(fields.issuing_authority),
      n(fields.joining_date),
      n(fields.assignment_start_date),
      userId,
    ],
  );
  return rowCount;
};

// ── Validation code sets ──────────────────────────────────────────────────────

/**
 * Loads all valid sending-org codes and visa-type codes for the BU in one
 * round-trip. Used by importUsersCsv to validate rows without a per-row query.
 */
export const loadValidCodes = async (businessUnit) => {
  const [soResult, vtResult] = await Promise.all([
    getPool().query(
      `SELECT code FROM v4.sending_org_tbl WHERE business_unit = $1 AND active = true`,
      [businessUnit],
    ),
    getPool().query(
      `SELECT code FROM v4.visa_list_tbl WHERE business_unit = $1 AND active = true`,
      [businessUnit],
    ),
  ]);
  return {
    sendingOrgCodes: new Set(soResult.rows.map((r) => r.code)),
    visaTypeCodes:   new Set(vtResult.rows.map((r) => r.code)),
  };
};

/**
 * Loads all valid reference codes for the BU in one round-trip.
 * Extends loadValidCodes to also include company_code set.
 */
export const loadReferenceCodes = async (businessUnit) => {
  const [soResult, vtResult, ccResult] = await Promise.all([
    getPool().query(
      `SELECT code FROM v4.sending_org_tbl WHERE business_unit = $1 AND active = true`,
      [businessUnit],
    ),
    getPool().query(
      `SELECT code FROM v4.visa_list_tbl WHERE business_unit = $1 AND active = true`,
      [businessUnit],
    ),
    getPool().query(
      `SELECT company_code FROM v4.company_tbl
       WHERE business_unit = $1 AND company_code IS NOT NULL AND is_active = true`,
      [businessUnit],
    ),
  ]);
  return {
    sendingOrgCodes: new Set(soResult.rows.map((r) => r.code)),
    visaTypeCodes:   new Set(vtResult.rows.map((r) => r.code)),
    companyCodes:    new Set(ccResult.rows.map((r) => r.company_code)),
  };
};

// ── Upload log ────────────────────────────────────────────────────────────────

/**
 * Inserts a bulk_upload_log header record and returns its id.
 */
export const insertUploadLog = async (log) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.bulk_upload_log
       (business_unit, uploaded_by, file_name, total_rows, success_count, error_count, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      log.business_unit,
      log.uploaded_by,
      log.file_name,
      log.total_rows,
      log.success_count,
      log.error_count,
      log.status,
    ],
  );
  return rows[0].id;
};

/**
 * Bulk-inserts all row-level detail records for an upload log.
 * Uses unnest() to avoid per-row round-trips.
 */
export const insertUploadLogRows = async (uploadId, rows) => {
  if (!rows.length) return;
  await getPool().query(
    `INSERT INTO v4.bulk_upload_log_row
       (upload_id, row_number, user_id, full_name, status, error_detail)
     SELECT $1,
            unnest($2::int[]),
            unnest($3::text[]),
            unnest($4::text[]),
            unnest($5::varchar(10)[]),
            unnest($6::text[])`,
    [
      uploadId,
      rows.map((r) => r.row_number),
      rows.map((r) => r.user_id   ?? null),
      rows.map((r) => r.full_name ?? null),
      rows.map((r) => r.status),
      rows.map((r) => r.error_detail ?? null),
    ],
  );
};

/**
 * Updates status + counts on an existing upload log record (e.g. when
 * background processing finishes).
 */
export const updateUploadLog = async (id, { total_rows, success_count, error_count, status }) => {
  await getPool().query(
    `UPDATE v4.bulk_upload_log
        SET total_rows    = $2,
            success_count = $3,
            error_count   = $4,
            status        = $5
      WHERE id = $1`,
    [id, total_rows, success_count, error_count, status],
  );
};

/**
 * Returns the 20 most-recent upload sessions for a BU.
 */
export const getUploadLogs = async (businessUnit, limit = 20) => {
  const { rows } = await getPool().query(
    `SELECT
       l.id,
       l.file_name,
       l.uploaded_at,
       l.total_rows,
       l.success_count,
       l.error_count,
       l.status,
       TRIM(COALESCE(p.first_name, '') || ' ' || COALESCE(p.last_name, '')) AS uploaded_by_name
     FROM v4.bulk_upload_log    l
     LEFT JOIN v4.user_profile_tbl p ON p.user_id = l.uploaded_by
     WHERE l.business_unit = $1
     ORDER BY l.uploaded_at DESC
     LIMIT $2`,
    [businessUnit, limit],
  );
  return rows;
};

/**
 * Returns all row-level records for a single upload (scoped to BU for safety).
 */
export const getUploadLogRows = async (uploadId, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT r.row_number, r.user_id, r.full_name, r.status, r.error_detail, r.created_at
     FROM v4.bulk_upload_log_row r
     JOIN  v4.bulk_upload_log    l ON l.id = r.upload_id
     WHERE r.upload_id    = $1
       AND l.business_unit = $2
     ORDER BY r.row_number`,
    [uploadId, businessUnit],
  );
  return rows;
};
