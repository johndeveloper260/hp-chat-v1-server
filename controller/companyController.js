/**
 * Company Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as companyService from "../services/companyService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

// ─────────────────────────────────────────────────────────────────────────────

export const getCompanies = async (req, res, next) => {
  try {
    const result = await companyService.getCompanies(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};

export const getCompanyDropdown = async (req, res, next) => {
  try {
    const result = await companyService.getCompanyDropdown(
      req.user.id,
      req.user.business_unit,
      req.query.feature,
    );
    res.json(result);
  } catch (err) { next(err); }
};

export const createCompany = async (req, res, next) => {
  try {
    const result = await companyService.createCompany(
      req.body,
      req.user.business_unit,
      req.user.id,
    );
    res.status(201).json({
      message: getApiMessage("company_created", lang(req)),
      ...result,
    });
  } catch (err) { next(err); }
};

export const updateCompany = async (req, res, next) => {
  try {
    const company = await companyService.updateCompany(
      req.params.id,
      req.user.business_unit,
      req.body,
      req.user.id,
    );
    res.json({ message: getApiMessage("company_updated", lang(req)), company });
  } catch (err) { next(err); }
};

export const deleteCompany = async (req, res, next) => {
  try {
    await companyService.deleteCompany(req.params.id, req.user.business_unit);
    res.json({ success: true, message: getApiMessage("company_deleted", lang(req)) });
  } catch (err) { next(err); }
};

export const getRegistrationCodes = async (req, res, next) => {
  try {
    const result = await companyService.getRegistrationCodes(
      req.params.companyId,
      req.user.business_unit,
    );
    res.json(result);
  } catch (err) { next(err); }
};

export const getEmployeesByCompany = async (req, res, next) => {
  try {
    const result = await companyService.getEmployeesByCompany(
      req.params.companyId,
      req.user.business_unit,
    );
    res.json(result);
  } catch (err) { next(err); }
};

export const getCoordinatorOptions = async (req, res, next) => {
  try {
    const result = await companyService.getCoordinatorOptions(req.user.business_unit);
    res.json(result);
  } catch (err) { next(err); }
};
