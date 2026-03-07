/**
 * Audit Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SQL, no business logic. All errors propagate via next(err).
 */
import * as auditService from "../services/auditService.js";

export const getAuditByRecord = async (req, res, next) => {
  try {
    const rows = await auditService.getAuditByRecord({
      sourceTable:  req.params.sourceTable,
      recordId:     req.params.recordId,
      businessUnit: req.user.business_unit,
      userId:       req.user.id,
      userType:     req.user.user_type,
    });
    res.json(rows);
  } catch (err) { next(err); }
};

export const getAuditByUser = async (req, res, next) => {
  try {
    const { source_table, limit = 100, offset = 0 } = req.query;
    const rows = await auditService.getAuditByUser({
      userId:       req.params.userId,
      businessUnit: req.user.business_unit,
      sourceTable:  source_table,
      limit,
      offset,
      callerType:   req.user.user_type,
    });
    res.json(rows);
  } catch (err) { next(err); }
};

export const searchAuditLog = async (req, res, next) => {
  try {
    const {
      source_table, field_name, changed_by, user_id,
      date_from, date_to, limit = 100, offset = 0,
    } = req.query;
    const rows = await auditService.searchAuditLog({
      businessUnit: req.user.business_unit,
      callerType:   req.user.user_type,
      sourceTable:  source_table,
      fieldName:    field_name,
      changedBy:    changed_by,
      userId:       user_id,
      dateFrom:     date_from,
      dateTo:       date_to,
      limit,
      offset,
    });
    res.json(rows);
  } catch (err) { next(err); }
};
