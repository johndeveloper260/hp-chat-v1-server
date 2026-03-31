/**
 * User Repository
 *
 * Raw SQL only — no business logic, no HTTP concerns.
 * Every function accepts an optional `client` for transaction support.
 * When no client is passed it falls back to the shared pool.
 */

import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a registration code and return the associated business metadata.
 */
export async function findRegistrationCode(code, client) {
  const { rows } = await db(client).query(
    `SELECT business_unit, role_name, company, batch_no
     FROM v4.customer_xref_tbl
     WHERE registration_code = $1`,
    [code],
  );
  return rows[0] ?? null;
}

/**
 * Insert a new user account row and return the generated UUID.
 */
export async function createUserAccount({ email, passwordHash, businessUnit }, client) {
  const { rows } = await db(client).query(
    `INSERT INTO v4.user_account_tbl
       (email, password_hash, business_unit, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())
     RETURNING id AS user_id`,
    [email, passwordHash, businessUnit],
  );
  return rows[0].user_id;
}

/**
 * Insert a user profile row.
 */
export async function createUserProfile(data, client) {
  const {
    userId, firstName, middleName, lastName, userType,
    position, company, companyBranch, phoneNumber,
    postalCode, streetAddress, city, state, batchNo, businessUnit,
  } = data;

  await db(client).query(
    `INSERT INTO v4.user_profile_tbl (
       user_id, first_name, middle_name, last_name, user_type,
       position, company, company_branch, phone_number,
       postal_code, street_address, city, state_province,
       batch_no, business_unit, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())`,
    [
      userId, firstName, middleName ?? null, lastName, userType,
      position ?? null, company ?? null, companyBranch ?? null, phoneNumber ?? null,
      postalCode ?? null, streetAddress ?? null, city ?? null, state ?? null,
      batchNo ?? null, businessUnit,
    ],
  );
}

/**
 * Insert a visa info row.
 */
export async function createVisaInfo({ userId, visaType, visaExpiry, businessUnit }, client) {
  await db(client).query(
    `INSERT INTO v4.user_visa_info_tbl
       (user_id, visa_type, visa_expiry_date, business_unit, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [userId, visaType, visaExpiry, businessUnit],
  );
}

/**
 * Grant the default read roles automatically for a new OFFICER account.
 */
export async function grantDefaultOfficerRoles(userId, client) {
  await db(client).query(
    `INSERT INTO v4.user_roles (user_id, role_name)
     VALUES ($1::uuid, 'announcements_read'), ($1::uuid, 'sharepoint_read')
     ON CONFLICT (user_id, role_name) DO NOTHING`,
    [userId],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch full user record needed for login — account + profile + visa + company
 * + latest profile picture. Returns null when the email is not found.
 */
export async function findUserByEmail(email, client) {
  const loginQuery = `
    SELECT
      a.id, a.email, a.password_hash, a.business_unit,
      a.is_active, a.preferred_language, a.notification, a.created_at AS account_created_at,
      p.user_id, p.first_name, p.middle_name, p.last_name,
      p.user_type, p.position, p.company, p.batch_no,
      p.company_branch, p.phone_number,
      p.postal_code, p.street_address, p.city, p.state_province,
      COALESCE(
        c.company_name ->> a.preferred_language,
        c.company_name ->> 'en',
        (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
      ) AS company_name,
      c.ticketing  AS company_ticketing,
      c.flight_tracker AS company_flight_tracker,
      c.company_form   AS company_form,
      v.visa_type,
      v.visa_expiry_date,
      v.passport_expiry,
      COALESCE(
        vl.descr ->> 'ja',
        vl.descr ->> 'en',
        (SELECT value FROM jsonb_each_text(vl.descr) LIMIT 1)
      ) AS visa_type_descr,
      bu.lock_screen_expire,
      sa.attachment_id AS profile_pic_id,
      sa.s3_key        AS profile_pic_s3_key,
      sa.s3_bucket     AS profile_pic_s3_bucket,
      sa.display_name  AS profile_pic_name,
      sa.file_type     AS profile_pic_type
    FROM v4.user_account_tbl a
    LEFT JOIN v4.user_profile_tbl p        ON a.id = p.user_id
    LEFT JOIN v4.company_tbl c             ON p.company::uuid = c.company_id
    LEFT JOIN v4.user_visa_info_tbl v      ON a.id = v.user_id
    LEFT JOIN v4.visa_list_tbl vl          ON v.visa_type = vl.code
                                          AND a.business_unit = vl.business_unit
    LEFT JOIN v4.business_unit_tbl bu      ON a.business_unit = bu.bu_code
    LEFT JOIN LATERAL (
      SELECT attachment_id, s3_key, s3_bucket, display_name, file_type
      FROM   v4.shared_attachments
      WHERE  relation_type = 'profile'
        AND  relation_id   = a.id::text
      ORDER  BY created_at DESC
      LIMIT  1
    ) sa ON true
    WHERE a.email = $1
  `;

  const { rows } = await db(client).query(loginQuery, [email]);
  return rows[0] ?? null;
}

/**
 * Fetch all role_name values assigned to a user.
 */
export async function findUserRoles(userId, client) {
  const { rows } = await db(client).query(
    `SELECT role_name FROM v4.user_roles WHERE user_id = $1::uuid ORDER BY role_name`,
    [userId],
  );
  return rows.map((r) => r.role_name);
}

/**
 * Stamp last_login timestamp.
 */
export async function updateLastLogin(userId, client) {
  await db(client).query(
    `UPDATE v4.user_account_tbl SET last_login = NOW() WHERE id = $1`,
    [userId],
  );
}

/**
 * Write an access log entry (IP + user-agent).
 */
export async function logAccess({ userId, businessUnit, ipAddress, userAgent }, client) {
  await db(client).query(
    `INSERT INTO v4.access_log_tbl (user_id, business_unit, ip_address, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [userId, businessUnit, ipAddress, userAgent],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Password management
// ─────────────────────────────────────────────────────────────────────────────

export async function updatePasswordHash(userId, passwordHash, client) {
  const { rowCount } = await db(client).query(
    `UPDATE v4.user_account_tbl
     SET password_hash = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [passwordHash, userId],
  );
  return rowCount;
}

export async function updatePasswordHashByEmail(email, passwordHash, client) {
  await db(client).query(
    `UPDATE v4.user_account_tbl SET password_hash = $1 WHERE email = $2`,
    [passwordHash, email],
  );
}

export async function findUserIdByEmail(email, client) {
  const { rows } = await db(client).query(
    `SELECT id FROM v4.user_account_tbl WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return rows[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP / Account deletion
// ─────────────────────────────────────────────────────────────────────────────

export async function setOtp({ email, otpCode, otpExpiry }, client) {
  await db(client).query(
    `UPDATE v4.user_account_tbl SET otp_code = $1, otp_expiry = $2 WHERE email = $3`,
    [otpCode, otpExpiry, email],
  );
}

export async function findUserForOtp(email, client) {
  const { rows } = await db(client).query(
    `SELECT id, otp_code, otp_expiry FROM v4.user_account_tbl WHERE email = $1`,
    [email.toLowerCase().trim()],
  );
  return rows[0] ?? null;
}

export async function deleteUserById(userId, client) {
  const { rowCount } = await db(client).query(
    `DELETE FROM v4.user_account_tbl WHERE id = $1`,
    [userId],
  );
  return rowCount;
}

export async function findUserInBusinessUnit(userId, businessUnit, client) {
  const { rows, rowCount } = await db(client).query(
    `SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2`,
    [userId, businessUnit],
  );
  return rowCount > 0 ? rows[0] : null;
}

export async function archiveUserBeforeDelete(userId, deletedBy, reason, client) {
  await db(client).query(
    `INSERT INTO v4.deleted_users_log
       (original_user_id, email, full_name, company_name, user_type, business_unit, deleted_by, deletion_reason)
     SELECT
       a.id,
       a.email,
       TRIM(CONCAT(p.first_name, ' ', p.middle_name, ' ', p.last_name)),
       COALESCE(c.company_name ->> a.preferred_language, c.company_name ->> 'ja', 'Unknown'),
       p.user_type,
       a.business_unit,
       $2,
       $3
     FROM v4.user_account_tbl a
     LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
     WHERE a.id = $1`,
    [userId, deletedBy, reason],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile
// ─────────────────────────────────────────────────────────────────────────────

export async function updateProfile(userId, fields, client) {
  const {
    first_name, middle_name, last_name, user_type, position,
    company, batch_no, company_branch, phone_number,
    postal_code, street_address, city, state_province,
    country, sending_org, emergency_contact_name,
    emergency_contact_number, emergency_contact_address,
    emergency_email, birthdate, gender, company_joining_date,
  } = fields;

  const cleanDate = (d) => (d === "" ? null : d ?? null);

  const { rows } = await db(client).query(
    `UPDATE v4.user_profile_tbl SET
       first_name = $1, middle_name = $2, last_name = $3,
       user_type = $4, position = $5, company = $6, batch_no = $7,
       company_branch = $8, phone_number = $9, postal_code = $10,
       street_address = $11, city = $12, state_province = $13,
       country = $14, sending_org = $15, emergency_contact_name = $16,
       emergency_contact_number = $17, emergency_contact_address = $18,
       emergency_email = $19, birthdate = $20, gender = $21,
       company_joining_date = $22, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $23
     RETURNING *`,
    [
      first_name, middle_name, last_name, user_type, position,
      company, batch_no, company_branch, phone_number,
      postal_code, street_address, city, state_province,
      country, sending_org, emergency_contact_name,
      emergency_contact_number, emergency_contact_address,
      emergency_email, cleanDate(birthdate), gender,
      cleanDate(company_joining_date), userId,
    ],
  );
  return rows[0] ?? null;
}

export async function updateUserLanguage(userId, language, client) {
  await db(client).query(
    `UPDATE v4.user_account_tbl SET preferred_language = $1 WHERE id = $2`,
    [language, userId],
  );
}

export async function updateNotificationPreference(userId, value, client) {
  await db(client).query(
    `UPDATE v4.user_account_tbl SET notification = $1, updated_at = NOW() WHERE id = $2`,
    [value, userId],
  );
}

export async function toggleUserActiveStatus(userId, businessUnit, client) {
  const { rows, rowCount } = await db(client).query(
    `SELECT id, is_active FROM v4.user_account_tbl
     WHERE id = $1::uuid AND business_unit = $2`,
    [userId, businessUnit],
  );
  if (rowCount === 0) return null;
  const newStatus = !rows[0].is_active;
  await db(client).query(
    `UPDATE v4.user_account_tbl SET is_active = $1, updated_at = NOW() WHERE id = $2`,
    [newStatus, userId],
  );
  return newStatus;
}

export async function findProfilePicture(userId, client) {
  const { rows } = await db(client).query(
    `SELECT s3_key, s3_bucket
     FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [String(userId)],
  );
  return rows[0] ?? null;
}

export async function findProfileAttachments(userId, client) {
  const { rows } = await db(client).query(
    `SELECT attachment_id, s3_key, s3_bucket
     FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1`,
    [String(userId)],
  );
  return rows;
}

export async function deleteProfileAttachments(userId, client) {
  await db(client).query(
    `DELETE FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1`,
    [String(userId)],
  );
}
