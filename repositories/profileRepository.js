/**
 * Profile Repository
 *
 * All raw SQL for user profile, visa info, avatar, and account fields.
 * Write functions accept an optional `client` for transaction support.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Language ──────────────────────────────────────────────────────────────────

export const findUserLanguage = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT preferred_language FROM v4.user_account_tbl WHERE id = $1",
    [userId],
  );
  return rows[0]?.preferred_language || "en";
};

// ── BU membership check ────────────────────────────────────────────────────────

/** Returns the account row if the user belongs to the given business_unit, else null. */
export const findUserInBU = async (userId, businessUnit, client) => {
  const { rows } = await db(client).query(
    "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
    [userId, businessUnit],
  );
  return rows[0] ?? null;
};

// ── BU settings ───────────────────────────────────────────────────────────────

/** Returns live BU-level feature flags for a given business unit code. */
export const getBUSettings = async (businessUnit) => {
  const { rows } = await getPool().query(
    "SELECT lock_screen_expire FROM v4.business_unit_tbl WHERE bu_code = $1",
    [businessUnit],
  );
  return rows[0] ?? null;
};

// ── Search users ──────────────────────────────────────────────────────────────

export const searchUsers = async (lang, businessUnit, { company, batch_no, name } = {}) => {
  const values = [lang, businessUnit];
  const parts  = [];

  let sql = `
    SELECT
      p.user_id,
      p.first_name,
      p.last_name,
      p.company,
      COALESCE(
        c.company_name ->> $1,
        c.company_name ->> 'ja',
        c.company_name ->> 'en',
        (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
      ) AS company_name,
      p.batch_no,
      p.position,
      p.user_type,
      a.is_active,
      a.email,
      a.last_seen
    FROM v4.user_profile_tbl p
    JOIN  v4.user_account_tbl a ON p.user_id = a.id
    LEFT JOIN v4.company_tbl  c ON p.company::uuid = c.company_id
    WHERE a.business_unit = $2
  `;

  if (company) {
    values.push(company);
    parts.push(`AND p.company = $${values.length}`);
  }
  if (batch_no) {
    values.push(batch_no);
    parts.push(`AND p.batch_no = $${values.length}`);
  }
  if (name) {
    values.push(`%${name}%`);
    parts.push(
      `AND (p.first_name ILIKE $${values.length} OR p.last_name ILIKE $${values.length})`,
    );
  }

  sql += ` ${parts.join(" ")} ORDER BY p.first_name ASC LIMIT 50`;
  const { rows } = await getPool().query(sql, values);
  return rows;
};

// ── Visa info ──────────────────────────────────────────────────────────────────

export const updateVisaInfo = async (userId, data, client) => {
  const toDate = (val) => (val === "" || !val ? null : val);
  await db(client).query(
    `UPDATE v4.user_visa_info_tbl
     SET
       visa_type = $1,            visa_number = $2,
       visa_issue_date = $3,      visa_expiry_date = $4,
       issuing_authority = $5,    passport_no = $6,
       passport_name = $7,        passport_expiry = $8,
       passport_issuing_country = $9, joining_date = $10,
       assignment_start_date = $11, updated_at = NOW()
     WHERE user_id = $12`,
    [
      data.visa_type,
      data.visa_number,
      toDate(data.visa_issue_date),
      toDate(data.visa_expiry_date),
      data.issuing_authority,
      data.passport_no,
      data.passport_name,
      toDate(data.passport_expiry),
      data.passport_issuing_country,
      toDate(data.joining_date),
      toDate(data.assignment_start_date),
      userId,
    ],
  );
};

// ── Legal profile (profile + visa) ────────────────────────────────────────────

export const findLegalProfile = async (userId, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT
       p.id AS profile_id,
       p.first_name, p.middle_name, p.last_name, p.user_type,
       p.position, p.company, p.company_branch,
       v.id AS visa_record_id,
       v.visa_type, v.visa_number, v.visa_issue_date, v.visa_expiry_date,
       v.passport_expiry, v.issuing_authority, v.passport_issuing_country,
       v.passport_no, v.passport_name,
       v.joining_date, v.assignment_start_date,
       a.created_at AS account_created_at
     FROM v4.user_profile_tbl p
     JOIN  v4.user_account_tbl a  ON p.user_id = a.id
     LEFT JOIN v4.user_visa_info_tbl v ON p.user_id = v.user_id
     WHERE p.user_id = $1 AND a.business_unit = $2`,
    [userId, businessUnit],
  );
  return rows[0] ?? null;
};

// ── Full profile with company name ────────────────────────────────────────────

export const findUserProfile = async (userId, businessUnit, lang) => {
  const { rows } = await getPool().query(
    `SELECT p.*,
       COALESCE(NULLIF(c.company_name->>$3, ''), NULLIF(c.company_name->>'en', ''), 'N/A') AS company_name_text
     FROM v4.user_profile_tbl p
     JOIN  v4.user_account_tbl a ON p.user_id = a.id
     LEFT JOIN v4.company_tbl  c ON p.company::uuid = c.company_id
     WHERE p.user_id = $1 AND a.business_unit = $2`,
    [userId, businessUnit, lang],
  );
  return rows[0] ?? null;
};

// ── Update profile ────────────────────────────────────────────────────────────

export const updateUserProfile = async (userId, data) => {
  const cleanDate = (d) => (d === "" ? null : d);
  const { rows } = await getPool().query(
    `UPDATE v4.user_profile_tbl SET
       first_name = $1,  middle_name = $2,  last_name = $3,
       user_type = $4,   position = $5,     company = $6,
       batch_no = $7,    company_branch = $8, phone_number = $9,
       postal_code = $10, street_address = $11, city = $12,
       state_province = $13, country = $14, sending_org = $15,
       emergency_contact_name = $16,   emergency_contact_number = $17,
       emergency_contact_address = $18, emergency_email = $19,
       birthdate = $20,  gender = $21,      company_joining_date = $22,
       updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $23 RETURNING *`,
    [
      data.first_name,           data.middle_name,           data.last_name,
      data.user_type,            data.position,              data.company,
      data.batch_no,             data.company_branch,        data.phone_number,
      data.postal_code,          data.street_address,        data.city,
      data.state_province,       data.country,               data.sending_org,
      data.emergency_contact_name, data.emergency_contact_number,
      data.emergency_contact_address, data.emergency_email,
      cleanDate(data.birthdate), data.gender,
      cleanDate(data.company_joining_date),
      userId,
    ],
  );
  return rows[0] ?? null;
};

// ── Toggle active ──────────────────────────────────────────────────────────────

export const findActiveStatus = async (userId, businessUnit) => {
  const { rows } = await getPool().query(
    "SELECT id, is_active FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
    [userId, businessUnit],
  );
  return rows[0] ?? null;
};

export const setActiveStatus = async (userId, isActive) => {
  await getPool().query(
    "UPDATE v4.user_account_tbl SET is_active = $1, updated_at = NOW() WHERE id = $2",
    [isActive, userId],
  );
};

// ── Language preference ────────────────────────────────────────────────────────

export const updatePreferredLanguage = async (userId, language) => {
  await getPool().query(
    "UPDATE v4.user_account_tbl SET preferred_language = $1 WHERE id = $2",
    [language, userId],
  );
};

// ── Avatar ────────────────────────────────────────────────────────────────────

/** Returns the most recent profile picture row ({ s3_key, s3_bucket }) or null. */
export const findLatestAvatar = async (userId) => {
  const { rows } = await getPool().query(
    `SELECT s3_key, s3_bucket
     FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  return rows[0] ?? null;
};
