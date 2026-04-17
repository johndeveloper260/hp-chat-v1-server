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

/** Returns the account row if the user belongs to the given business_unit and is active, else null. */
export const findUserInBU = async (userId, businessUnit, client) => {
  const { rows } = await db(client).query(
    "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2 AND is_active = true",
    [userId, businessUnit],
  );
  return rows[0] ?? null;
};

// ── BU settings ───────────────────────────────────────────────────────────────

/** Returns live BU-level feature flags for a given business unit code. */
export const getBUSettings = async (businessUnit) => {
  const { rows } = await getPool().query(
    "SELECT lock_screen_expire, lock_screen_expire_days, souser_enabled, task_enabled, assessment_enabled FROM v4.business_unit_tbl WHERE bu_code = $1",
    [businessUnit],
  );
  return rows[0] ?? null;
};

// ── Search users ──────────────────────────────────────────────────────────────

export const searchUsers = async (lang, businessUnit, { company, batch_no, name, country, sending_org, visa_type, passport_expiry_within, visa_expiry_within, user_type } = {}) => {
  const values = [lang, businessUnit];
  const parts  = [];

  let sql = `
    SELECT
      p.user_id,
      p.first_name,
      p.last_name,
      p.middle_name,
      p.company,
      COALESCE(
        c.company_name ->> $1,
        c.company_name ->> 'ja',
        c.company_name ->> 'en',
        (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
      ) AS company_name,
      p.batch_no,
      p.position,
      COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END) AS user_type,
      a.is_active,
      a.email,
      a.last_seen,
      CASE WHEN UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) IN ('OFFICER','ADMIN') THEN NULL ELSE p.country           END AS country,
      p.gender,
      CASE WHEN p.birthdate IS NOT NULL THEN EXTRACT(YEAR FROM AGE(p.birthdate))::int ELSE NULL END AS age,
      CASE WHEN UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) IN ('OFFICER','ADMIN') THEN NULL ELSE s.descr             END AS sending_org_descr,
      CASE WHEN UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) IN ('OFFICER','ADMIN') THEN NULL ELSE v.passport_expiry   END AS passport_expiry,
      CASE WHEN UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) IN ('OFFICER','ADMIN') THEN NULL ELSE v.visa_expiry_date  END AS visa_expiry_date,
      CASE WHEN UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) IN ('OFFICER','ADMIN') THEN NULL ELSE COALESCE(vl.descr ->> $1, vl.descr ->> 'en') END AS visa_type_descr
    FROM v4.user_profile_tbl p
    JOIN  v4.user_account_tbl a  ON p.user_id = a.id
    LEFT JOIN v4.souser_tbl   su ON su.id = a.id
    LEFT JOIN v4.company_tbl  c  ON p.company::uuid = c.company_id
    LEFT JOIN v4.sending_org_tbl s  ON s.code = p.sending_org AND s.business_unit = a.business_unit
    LEFT JOIN v4.user_visa_info_tbl v  ON v.user_id = p.user_id
    LEFT JOIN v4.visa_list_tbl vl  ON vl.code = v.visa_type AND vl.business_unit = a.business_unit
    WHERE a.business_unit = $2
      AND a.is_active = true
  `;

  // Helper: push a single-or-array filter onto parts/values
  const pushMulti = (field, param, transform = (v) => v) => {
    if (!param) return;
    const items = (Array.isArray(param) ? param : param.split(',')).map(transform).filter(Boolean);
    if (!items.length) return;
    if (items.length === 1) {
      values.push(items[0]);
      parts.push(`AND ${field} = $${values.length}`);
    } else {
      values.push(items);
      parts.push(`AND ${field} = ANY($${values.length})`);
    }
  };

  if (company)      pushMulti('p.company', company);
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
  if (country)      pushMulti('UPPER(p.country)', country, (v) => v.toUpperCase());
  if (sending_org)  pushMulti('p.sending_org', sending_org);
  if (visa_type)    pushMulti('v.visa_type', visa_type);
  if (user_type) {
    const types = (Array.isArray(user_type) ? user_type : user_type.split(',')).map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (types.length) {
      values.push(types);
      parts.push(`AND UPPER(COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END)) = ANY($${values.length})`);
    }
  }
  if (passport_expiry_within) {
    values.push(Number(passport_expiry_within));
    parts.push(`AND UPPER(p.user_type) NOT IN ('OFFICER','ADMIN') AND v.passport_expiry IS NOT NULL AND v.passport_expiry <= CURRENT_DATE + ($${values.length}::int * INTERVAL '1 day')`);
  }
  if (visa_expiry_within) {
    values.push(Number(visa_expiry_within));
    parts.push(`AND UPPER(p.user_type) NOT IN ('OFFICER','ADMIN') AND v.visa_expiry_date IS NOT NULL AND v.visa_expiry_date <= CURRENT_DATE + ($${values.length}::int * INTERVAL '1 day')`);
  }

  sql += ` ${parts.join(" ")} ORDER BY p.first_name ASC`;
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

export const updateUserProfile = async (userId, data, businessUnit) => {
  const cleanDate = (d) => (d === "" ? null : d);
  const { rows } = await getPool().query(
    `INSERT INTO v4.user_profile_tbl (
       user_id, first_name, middle_name, last_name, user_type, position, company,
       batch_no, company_branch, phone_number, postal_code, street_address, city,
       state_province, country, sending_org, emergency_contact_name,
       emergency_contact_number, emergency_contact_address, emergency_email,
       birthdate, gender, company_joining_date, business_unit,
       created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       first_name              = EXCLUDED.first_name,
       middle_name             = EXCLUDED.middle_name,
       last_name               = EXCLUDED.last_name,
       user_type               = EXCLUDED.user_type,
       position                = EXCLUDED.position,
       company                 = EXCLUDED.company,
       batch_no                = EXCLUDED.batch_no,
       company_branch          = EXCLUDED.company_branch,
       phone_number            = EXCLUDED.phone_number,
       postal_code             = EXCLUDED.postal_code,
       street_address          = EXCLUDED.street_address,
       city                    = EXCLUDED.city,
       state_province          = EXCLUDED.state_province,
       country                 = EXCLUDED.country,
       sending_org             = EXCLUDED.sending_org,
       emergency_contact_name    = EXCLUDED.emergency_contact_name,
       emergency_contact_number  = EXCLUDED.emergency_contact_number,
       emergency_contact_address = EXCLUDED.emergency_contact_address,
       emergency_email           = EXCLUDED.emergency_email,
       birthdate               = EXCLUDED.birthdate,
       gender                  = EXCLUDED.gender,
       company_joining_date    = EXCLUDED.company_joining_date,
       updated_at              = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      userId,
      data.first_name,           data.middle_name,           data.last_name,
      data.user_type,            data.position,              data.company,
      data.batch_no,             data.company_branch,        data.phone_number,
      data.postal_code,          data.street_address,        data.city,
      data.state_province,       data.country,               data.sending_org,
      data.emergency_contact_name, data.emergency_contact_number,
      data.emergency_contact_address, data.emergency_email,
      cleanDate(data.birthdate), data.gender,
      cleanDate(data.company_joining_date),
      businessUnit,
    ],
  );
  return rows[0] ?? null;
};

// ── Toggle active ──────────────────────────────────────────────────────────────

export const findActiveStatus = async (userId, businessUnit) => {
  const { rows } = await getPool().query(
    "SELECT id, is_active FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2 AND is_active = true",
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

// ── Auto-translate chat ────────────────────────────────────────────────────────

export const updateAutoTranslateChat = async (userId, enabled) => {
  await getPool().query(
    "UPDATE v4.user_account_tbl SET auto_translate_chat = $1 WHERE id = $2",
    [enabled, userId],
  );
};

export const updateTranslateExceptions = async (userId, exceptions) => {
  await getPool().query(
    "UPDATE v4.user_account_tbl SET translate_exceptions = $1 WHERE id = $2",
    [exceptions, userId],
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
