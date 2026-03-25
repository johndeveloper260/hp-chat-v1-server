/**
 * Sending Organisation Service
 *
 * No req/res — throws AppError subclasses on failure.
 */
import * as sendingOrgRepo from "../repositories/sendingOrgRepository.js";
import { getUserLanguage } from "../utils/getUserLanguage.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";

// ── Dropdown (existing) ────────────────────────────────────────────────────────

export const getSendingOrgs = async (countryOrigin, businessUnit) => {
  const { rows } = await sendingOrgRepo.findSendingOrgs(countryOrigin, businessUnit);
  return rows;
};

export const getVisaList = async (lang, businessUnit) => {
  const { rows } = await sendingOrgRepo.findVisaList(lang, businessUnit);
  return rows;
};

// ── CRUD ──────────────────────────────────────────────────────────────────────

export const getSendingOrgList = async (businessUnit) => {
  const { rows } = await sendingOrgRepo.findAllByBU(businessUnit);
  return rows;
};

export const createSendingOrg = async (data, businessUnit) => {
  const existing = await sendingOrgRepo.countByCode(data.code, businessUnit);
  if (parseInt(existing.rows[0].count, 10) > 0) {
    throw new ConflictError("sending_org_code_exists");
  }
  const { rows } = await sendingOrgRepo.insertSendingOrg({ ...data, businessUnit });
  return rows[0];
};

export const updateSendingOrg = async (code, businessUnit, data) => {
  const { rows } = await sendingOrgRepo.updateSendingOrgByCode(code, businessUnit, data);
  if (!rows[0]) throw new NotFoundError("sending_org_not_found");
  return rows[0];
};

export const deleteSendingOrg = async (code, businessUnit) => {
  const { rowCount } = await sendingOrgRepo.deleteSendingOrgByCode(code, businessUnit);
  if (rowCount === 0) throw new NotFoundError("sending_org_not_found");
};
