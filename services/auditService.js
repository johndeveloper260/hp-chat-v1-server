/**
 * Audit Service
 *
 * Enforces access-control rules before delegating to the repository.
 * No req/res — throws AppError subclasses on failure.
 */
import * as auditRepo from "../repositories/auditRepository.js";
import { ForbiddenError, ValidationError } from "../errors/AppError.js";

const ELEVATED_ROLES  = ["OFFICER", "ADMIN"];
const ALLOWED_TABLES  = ["inquiry_tbl", "return_home_tbl"];

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the audit trail for a specific record.
 * Non-elevated users can only view their own records.
 */
export const getAuditByRecord = async ({
  sourceTable,
  recordId,
  businessUnit,
  userId,
  userType,
}) => {
  if (!ALLOWED_TABLES.includes(sourceTable)) {
    throw new ValidationError(
      "audit_invalid_table",
      "api_errors.audit.invalid_table",
    );
  }

  if (!ELEVATED_ROLES.includes((userType || "").toUpperCase())) {
    const ownerCheck = await auditRepo.findRecordOwnership(
      sourceTable,
      recordId,
      userId,
      businessUnit,
    );
    if (ownerCheck.rowCount === 0) {
      throw new ForbiddenError("forbidden", "api_errors.auth.forbidden");
    }
  }

  const { rows } = await auditRepo.findAuditByRecord(sourceTable, recordId, businessUnit);
  return rows;
};

/**
 * Returns all audit entries made by a specific user.
 * Officers / Admins only.
 */
export const getAuditByUser = async ({
  userId,
  businessUnit,
  sourceTable,
  limit,
  offset,
  callerType,
}) => {
  if (!ELEVATED_ROLES.includes((callerType || "").toUpperCase())) {
    throw new ForbiddenError("forbidden", "api_errors.auth.forbidden");
  }
  const { rows } = await auditRepo.findAuditByUser(
    userId,
    businessUnit,
    sourceTable,
    limit,
    offset,
  );
  return rows;
};

/**
 * General filtered audit search.
 * Officers / Admins only.
 */
export const searchAuditLog = async ({ businessUnit, callerType, ...filters }) => {
  if (!ELEVATED_ROLES.includes((callerType || "").toUpperCase())) {
    throw new ForbiddenError("forbidden", "api_errors.auth.forbidden");
  }
  const { rows } = await auditRepo.searchAudit(businessUnit, filters);
  return rows;
};
