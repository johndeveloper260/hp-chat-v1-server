/**
 * Leave Repository
 *
 * Raw SQL for leave_template_tbl, leave_submission_tbl, and supporting
 * lookups used during email dispatch (company name, BU name, applicant name,
 * attachment signed-URL resolution).
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

// ── Templates ─────────────────────────────────────────────────────────────────

/**
 * Insert or update a leave template.
 * When `templateId` is truthy the existing row is updated; otherwise a new
 * row is inserted.
 */
export const upsertLeaveTemplate = async (templateId, userId, data) => {
  if (templateId) {
    const { rows } = await getPool().query(
      `UPDATE v4.leave_template_tbl
       SET config = $1, fields = $2, version = version + 0.1,
           last_updated_by = $3, updated_at = NOW(),
           title = $5, description = $6, category = $7, is_published = $8
       WHERE template_id = $4
       RETURNING *`,
      [
        data.configJSON,
        data.fieldsJSON,
        userId,
        templateId,
        data.title        || "",
        data.description  || null,
        data.category     || null,
        data.is_published ?? false,
      ],
    );
    return rows[0] ?? null;
  }

  const { rows } = await getPool().query(
    `INSERT INTO v4.leave_template_tbl
       (company_id, business_unit, config, fields, last_updated_by,
        title, description, category, is_published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      data.company,
      data.business_unit,
      data.configJSON,
      data.fieldsJSON,
      userId,
      data.title        || "",
      data.description  || null,
      data.category     || null,
      data.is_published ?? false,
    ],
  );
  return rows[0];
};

export const findCompanyTemplates = async (company, businessUnit, publishedOnly = false) => {
  const { rows } = await getPool().query(
    `SELECT template_id, title, description, category, is_published, version, updated_at
     FROM v4.leave_template_tbl
     WHERE company_id = $1 AND business_unit = $2 AND is_active = true
       AND ($3::boolean IS FALSE OR is_published = true)
     ORDER BY updated_at DESC`,
    [company, businessUnit, publishedOnly],
  );
  return rows;
};

/**
 * Fetch a single template.
 * Pass `templateId` to get it by ID; otherwise fetches the latest for
 * the given company + businessUnit.
 */
export const findLeaveTemplate = async ({
  templateId,
  company,
  businessUnit,
} = {}) => {
  if (templateId) {
    const { rows } = await getPool().query(
      `SELECT template_id, version, config, fields, title, description, category, is_published
       FROM v4.leave_template_tbl
       WHERE template_id = $1 AND is_active = true`,
      [templateId],
    );
    return rows[0] ?? null;
  }

  const { rows } = await getPool().query(
    `SELECT template_id, version, config, fields, title, description, category, is_published
     FROM v4.leave_template_tbl
     WHERE company_id = $1 AND business_unit = $2 AND is_active = true
     ORDER BY updated_at DESC LIMIT 1`,
    [company, businessUnit],
  );
  return rows[0] ?? null;
};

export const softDeleteLeaveTemplate = async (templateId) => {
  const { rows } = await getPool().query(
    `UPDATE v4.leave_template_tbl
     SET is_active = false, updated_at = NOW()
     WHERE template_id = $1 AND is_active = true
     RETURNING template_id`,
    [templateId],
  );
  return rows[0] ?? null;
};

// ── On-behalf user lookup ──────────────────────────────────────────────────────

export const findTargetUser = async (targetUserId) => {
  const { rows } = await getPool().query(
    `SELECT a.id AS user_id, p.company, a.business_unit
     FROM v4.user_account_tbl a
     JOIN v4.user_profile_tbl p ON a.id = p.user_id
     WHERE a.id = $1`,
    [targetUserId],
  );
  return rows[0] ?? null;
};

// ── Submissions ───────────────────────────────────────────────────────────────

export const insertSubmission = async ({
  templateId,
  userId,
  company,
  businessUnit,
  answersJSON,
}) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.leave_submission_tbl
       (template_id, user_id, company_id, business_unit, answers, status)
     VALUES ($1,$2,$3,$4,$5,'sent')
     RETURNING *`,
    [templateId, userId, company, businessUnit, answersJSON],
  );
  return rows[0];
};

export const findTemplateConfig = async (templateId) => {
  const { rows } = await getPool().query(
    "SELECT config, fields, title FROM v4.leave_template_tbl WHERE template_id = $1",
    [templateId],
  );
  return rows[0] ?? null;
};

// ── Email support lookups ──────────────────────────────────────────────────────

export const findCompanyName = async (companyId) => {
  const { rows } = await getPool().query(
    `SELECT company_name->>'en' AS name_en, company_name->>'ja' AS name_jp
     FROM v4.company_tbl WHERE company_id = $1`,
    [companyId],
  );
  if (!rows[0]) return "Our Company";
  return rows[0].name_jp || rows[0].name_en || "Our Company";
};

export const findBuName = async (businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT bu_name->>'ja' AS bu_jp, bu_name->>'en' AS bu_en
     FROM v4.business_unit_tbl WHERE bu_code = $1`,
    [businessUnit],
  );
  if (!rows[0]) return "General Dept";
  return rows[0].bu_jp || rows[0].bu_en || "General Dept";
};

export const findApplicantName = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT first_name, middle_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1",
    [userId],
  );
  if (!rows[0]) return "An Employee";
  return formatDisplayName(rows[0].last_name, rows[0].first_name, rows[0].middle_name);
};

export const findAttachmentForEmail = async (attachmentId) => {
  const { rows } = await getPool().query(
    "SELECT s3_key, s3_bucket, display_name FROM v4.attachments_tbl WHERE attachment_id = $1",
    [attachmentId],
  );
  return rows[0] ?? null;
};

// ── Company and user submissions ──────────────────────────────────────────────

export const findCompanySubmissions = async (
  businessUnit,
  companyId,
  startDate,
  endDate,
  lang,
) => {
  const { rows } = await getPool().query(
    `SELECT
       s.id, s.submission_id, s.status, s.answers, s.created_at,
       u.email, p.first_name, p.last_name,
       COALESCE(c.company_name->>$3, c.company_name->>'en') AS company_name,
       COALESCE(t.fields,    t_default.fields) AS template_fields,
       COALESCE(t.title,     t_default.title)  AS template_title
     FROM v4.leave_submission_tbl s
     JOIN  v4.user_account_tbl u ON s.user_id = u.id
     JOIN  v4.user_profile_tbl p ON u.id      = p.user_id
     LEFT JOIN v4.company_tbl  c ON s.company_id = c.company_id::text
     LEFT JOIN v4.leave_template_tbl t ON s.template_id = t.template_id
     LEFT JOIN LATERAL (
       SELECT title, fields FROM v4.leave_template_tbl
       WHERE company_id::text = s.company_id
         AND business_unit = s.business_unit
         AND is_active = true
       ORDER BY updated_at DESC LIMIT 1
     ) t_default ON s.template_id IS NULL
     WHERE s.business_unit = $1
       AND ($2::text IS NULL OR s.company_id = $2)
       AND ($4::timestamptz IS NULL OR s.created_at >= $4)
       AND ($5::timestamptz IS NULL OR s.created_at <= $5)
     ORDER BY s.created_at DESC
     LIMIT 50`,
    [businessUnit, companyId, lang, startDate, endDate],
  );
  return rows;
};

export const findMySubmissions = async (userId, lang) => {
  const { rows } = await getPool().query(
    `SELECT
       s.id, s.submission_id, s.status, s.answers, s.created_at,
       u.email, p.first_name, p.last_name,
       COALESCE(c.company_name->>$2, c.company_name->>'en') AS company_name,
       COALESCE(t.fields,    t_default.fields) AS template_fields,
       COALESCE(t.title,     t_default.title)  AS template_title
     FROM v4.leave_submission_tbl s
     JOIN  v4.user_account_tbl u ON s.user_id = u.id
     JOIN  v4.user_profile_tbl p ON u.id      = p.user_id
     LEFT JOIN v4.company_tbl  c ON s.company_id = c.company_id::text
     LEFT JOIN v4.leave_template_tbl t ON s.template_id = t.template_id
     LEFT JOIN LATERAL (
       SELECT title, fields FROM v4.leave_template_tbl
       WHERE company_id::text = s.company_id
         AND business_unit = s.business_unit
         AND is_active = true
       ORDER BY updated_at DESC LIMIT 1
     ) t_default ON s.template_id IS NULL
     WHERE s.user_id = $1
     ORDER BY s.created_at DESC
     LIMIT 100`,
    [userId, lang],
  );
  return rows;
};
