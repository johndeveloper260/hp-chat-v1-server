/**
 * Issue Type Service
 *
 * No req/res — throws AppError subclasses on failure.
 */
import * as issueTypeRepo from "../repositories/issueTypeRepository.js";
import { NotFoundError, ConflictError } from "../errors/AppError.js";

export const getIssueTypeList = async (businessUnit) => {
  const { rows } = await issueTypeRepo.findAllByBU(businessUnit);
  return rows;
};

export const createIssueType = async (data, businessUnit, userId) => {
  const existing = await issueTypeRepo.countByCode(data.code, businessUnit);
  if (parseInt(existing.rows[0].count, 10) > 0) {
    throw new ConflictError("issue_type_code_exists");
  }
  const { rows } = await issueTypeRepo.insertIssueType({ ...data, businessUnit, userId });
  return rows[0];
};

export const updateIssueType = async (code, businessUnit, data, userId) => {
  const { rows } = await issueTypeRepo.updateIssueTypeByCode(code, businessUnit, data, userId);
  if (!rows[0]) throw new NotFoundError("issue_type_not_found");
  return rows[0];
};

export const deleteIssueType = async (code, businessUnit) => {
  const inUse = await issueTypeRepo.countInquiriesByType(code, businessUnit);
  if (parseInt(inUse.rows[0].count, 10) > 0) {
    throw new ConflictError("issue_type_in_use", "issue_type_in_use");
  }
  const { rowCount } = await issueTypeRepo.deleteIssueTypeByCode(code, businessUnit);
  if (rowCount === 0) throw new NotFoundError("issue_type_not_found");
};
