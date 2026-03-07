/**
 * Audit Repository
 *
 * All SQL for reading the app_audit_log table.
 */
import { getPool } from "../config/getPool.js";

// ─────────────────────────────────────────────────────────────────────────────
// Ownership guard (used for non-elevated users)
// ─────────────────────────────────────────────────────────────────────────────

const OWNERSHIP_QUERIES = {
  inquiry_tbl:
    `SELECT ticket_id FROM v4.inquiry_tbl
     WHERE ticket_id = $1 AND owner_id = $2 AND business_unit = $3`,
  return_home_tbl:
    `SELECT id FROM v4.return_home_tbl
     WHERE id = $1 AND user_id = $2 AND business_unit = $3`,
};

export const findRecordOwnership = (sourceTable, recordId, userId, businessUnit) =>
  getPool().query(OWNERSHIP_QUERIES[sourceTable], [recordId, userId, businessUnit]);

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

export const findAuditByRecord = (sourceTable, recordId, businessUnit) =>
  getPool().query(
    `SELECT
       a.audit_id, a.operation, a.field_name, a.old_value, a.new_value,
       a.changed_at, a.changed_by,
       TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name
     FROM v4.app_audit_log a
     LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
     WHERE a.source_table = $1 AND a.record_id = $2 AND a.business_unit = $3
     ORDER BY a.changed_at DESC`,
    [sourceTable, recordId, businessUnit],
  );

export const findAuditByUser = (userId, businessUnit, sourceTable, limit, offset) => {
  const values = [userId, businessUnit];
  let query = `
    SELECT a.audit_id, a.source_table, a.record_id, a.operation,
           a.field_name, a.old_value, a.new_value, a.changed_at,
           TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name
    FROM v4.app_audit_log a
    LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
    WHERE a.changed_by = $1 AND a.business_unit = $2`;
  if (sourceTable) { values.push(sourceTable); query += ` AND a.source_table = $${values.length}`; }
  values.push(Number(limit), Number(offset));
  query += ` ORDER BY a.changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
  return getPool().query(query, values);
};

export const searchAudit = (businessUnit, { sourceTable, fieldName, changedBy, userId, dateFrom, dateTo, limit = 100, offset = 0 }) => {
  const values = [businessUnit];
  let query = `
    SELECT a.audit_id, a.source_table, a.record_id, a.operation,
           a.field_name, a.old_value, a.new_value, a.changed_at, a.changed_by,
           TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name,
           a.user_id AS subject_user_id,
           TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS subject_user_name
    FROM v4.app_audit_log a
    LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
    LEFT JOIN v4.user_profile_tbl s ON a.user_id = s.user_id
    WHERE a.business_unit = $1`;
  if (sourceTable) { values.push(sourceTable); query += ` AND a.source_table = $${values.length}`; }
  if (fieldName)   { values.push(fieldName);   query += ` AND a.field_name = $${values.length}`; }
  if (changedBy)   { values.push(changedBy);   query += ` AND a.changed_by = $${values.length}::uuid`; }
  if (userId)      { values.push(userId);      query += ` AND a.user_id = $${values.length}::uuid`; }
  if (dateFrom)    { values.push(dateFrom);    query += ` AND a.changed_at >= $${values.length}::timestamptz`; }
  if (dateTo)      { values.push(dateTo);      query += ` AND a.changed_at <= $${values.length}::timestamptz`; }
  values.push(Number(limit), Number(offset));
  query += ` ORDER BY a.changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;
  return getPool().query(query, values);
};
