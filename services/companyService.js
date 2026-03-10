/**
 * Company Service
 *
 * All company management business logic.
 * No req/res — throws AppError subclasses on failure.
 */
import { getPool } from "../config/getPool.js";
import * as companyRepo from "../repositories/companyRepository.js";
import { getUserLanguage } from "../utils/getUserLanguage.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";

const ALLOWED_FEATURES = ["ticketing", "flight_tracker", "company_form"];

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export const getCompanies = async (businessUnit) => {
  const { rows } = await companyRepo.findCompaniesByBU(businessUnit);
  return rows;
};

export const getCompanyDropdown = async (userId, businessUnit, feature) => {
  const lang = await getUserLanguage(userId);
  const featureFilter = ALLOWED_FEATURES.includes(feature)
    ? `AND ${feature} = true`
    : "";
  const { rows } = await companyRepo.findCompanyDropdown(businessUnit, lang, featureFilter);
  return rows;
};

export const getEmployeesByCompany = async (companyId, businessUnit) => {
  const { rows } = await companyRepo.findEmployeesByCompany(companyId, businessUnit);
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────────
// Mutations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Creates a company + auto-generates 3 registration codes (USER, OFFICER, ADMIN).
 * Runs inside a single PostgreSQL transaction.
 */
export const createCompany = async (data, businessUnit, userId) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const companyRes = await companyRepo.insertCompany(
      { ...data, businessUnit, userId },
      client,
    );
    const companyId = companyRes.rows[0].company_id;
    const xrefRes = await companyRepo.insertRegistrationCodes(businessUnit, companyId, client);
    await client.query("COMMIT");
    return { company: companyRes.rows[0], registration_codes: xrefRes.rows };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

export const updateCompany = async (id, businessUnit, data, userId) => {
  const { rows } = await companyRepo.updateCompanyById(id, businessUnit, data, userId);
  if (!rows[0]) throw new NotFoundError("company_not_found");
  return rows[0];
};

/**
 * Blocks deletion if any users are registered under this company.
 */
export const deleteCompany = async (id, businessUnit) => {
  const countRes = await companyRepo.countUsersInCompany(id, businessUnit);
  if (parseInt(countRes.rows[0].count, 10) > 0) {
    throw new ConflictError("company_has_users", "api_errors.company.has_users");
  }
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await companyRepo.deleteXrefByCompany(id, businessUnit, client);
    const { rowCount } = await companyRepo.deleteCompanyById(id, businessUnit, client);
    if (rowCount === 0) throw new NotFoundError("company_not_found");
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
