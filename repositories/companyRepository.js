/**
 * Company Repository
 *
 * All SQL for company management lives here.
 * Accepts optional `client` for transaction participation.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Reads ─────────────────────────────────────────────────────────────────────

export const findCompaniesByBU = (businessUnit) =>
  getPool().query(
    `SELECT * FROM v4.company_tbl
     WHERE business_unit = $1
     ORDER BY sort_order ASC`,
    [businessUnit],
  );

export const findCompanyDropdown = (businessUnit, lang, featureFilter = "") =>
  getPool().query(
    `SELECT company_id AS value,
            COALESCE(company_name->>$2, company_name->>'en') AS label
     FROM v4.company_tbl
     WHERE is_active = true
       AND business_unit = $1
       ${featureFilter}
     ORDER BY sort_order ASC, label ASC`,
    [businessUnit, lang],
  );

export const findEmployeesByCompany = (companyId, businessUnit) =>
  getPool().query(
    `SELECT a.id, p.first_name, p.last_name,
            (p.first_name || ' ' || p.last_name) AS full_name, a.email
     FROM v4.user_account_tbl a
     JOIN v4.user_profile_tbl p ON a.id = p.user_id
     WHERE p.company = $1 AND a.business_unit = $2
     ORDER BY p.first_name ASC`,
    [companyId, businessUnit],
  );

export const countUsersInCompany = (companyId, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE p.company::uuid = $1::uuid AND a.business_unit = $2`,
    [companyId, businessUnit],
  );

// ── Mutations ─────────────────────────────────────────────────────────────────

export const insertCompany = (
  { company_name, website_url, is_active, ticketing, flight_tracker, company_form, sort_order, businessUnit, userId },
  client,
) =>
  db(client).query(
    `INSERT INTO v4.company_tbl
       (company_name, business_unit, website_url, is_active, ticketing, flight_tracker, company_form, sort_order, last_updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [company_name, businessUnit, website_url, is_active ?? true, ticketing ?? false, flight_tracker ?? false, company_form ?? false, sort_order ?? 0, userId],
  );

export const insertRegistrationCodes = (businessUnit, companyId, client) =>
  db(client).query(
    `INSERT INTO v4.customer_xref_tbl (business_unit, role_name, company, batch_no)
     VALUES ($1, 'USER', $2::uuid, NULL), ($1, 'OFFICER', $2::uuid, NULL), ($1, 'ADMIN', $2::uuid, NULL)
     RETURNING *`,
    [businessUnit, companyId],
  );

export const updateCompanyById = (id, businessUnit, data, userId) => {
  const { company_name, website_url, is_active, ticketing, flight_tracker, company_form, sort_order } = data;
  return getPool().query(
    `UPDATE v4.company_tbl
     SET company_name = $1, website_url = $2, is_active = $3,
         ticketing = $4, flight_tracker = $5, company_form = $6,
         sort_order = $7, last_updated_by = $8, updated_at = NOW()
     WHERE company_id = $9 AND business_unit = $10
     RETURNING *`,
    [company_name, website_url, is_active, ticketing ?? false, flight_tracker ?? false, company_form ?? false, sort_order ?? 0, userId, id, businessUnit],
  );
};

export const findXrefByCompany = (companyId, businessUnit, client) =>
  db(client).query(
    `SELECT sequence_id, role_name, batch_no, registration_code
     FROM v4.customer_xref_tbl
     WHERE company = $1::uuid AND business_unit = $2
     ORDER BY role_name ASC,
              CASE WHEN batch_no IS NULL THEN 0
                   ELSE regexp_replace(batch_no, '[^0-9]', '', 'g')::int
              END ASC`,
    [companyId, businessUnit],
  );

export const deleteXrefByCompany = (companyId, businessUnit, client) =>
  db(client).query(
    `DELETE FROM v4.customer_xref_tbl WHERE company = $1 AND business_unit = $2`,
    [companyId, businessUnit],
  );

export const deleteCompanyById = (id, businessUnit, client) =>
  db(client).query(
    `DELETE FROM v4.company_tbl WHERE company_id = $1 AND business_unit = $2`,
    [id, businessUnit],
  );
