import { getPool } from "../config/getPool.js";

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];

// 1. GET AUDIT LOG FOR A SPECIFIC RECORD
// Usage: GET /audit/record/:sourceTable/:recordId
// - Any authenticated user can view history of records in their BU
// - Non-elevated users can only view their own records
export const getAuditByRecord = async (req, res) => {
  const { sourceTable, recordId } = req.params;
  const businessUnit = req.user.business_unit;
  const userId = req.user.id;
  const userRole = req.user.userType?.toUpperCase() || "";

  const ALLOWED_TABLES = ["inquiry_tbl", "return_home_tbl"];
  if (!ALLOWED_TABLES.includes(sourceTable)) {
    return res.status(400).json({ error: "Invalid source table" });
  }

  try {
    // For non-elevated users, verify the record belongs to them before returning audit
    if (!ELEVATED_ROLES.includes(userRole)) {
      const ownershipMap = {
        inquiry_tbl: `SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND owner_id = $2 AND business_unit = $3`,
        return_home_tbl: `SELECT id FROM v4.return_home_tbl WHERE id = $1 AND user_id = $2 AND business_unit = $3`,
      };
      const ownerCheck = await getPool().query(ownershipMap[sourceTable], [
        recordId,
        userId,
        businessUnit,
      ]);
      if (ownerCheck.rowCount === 0) {
        return res.status(403).json({ error: "Access denied" });
      }
    }

    const query = `
      SELECT
        a.audit_id,
        a.operation,
        a.field_name,
        a.old_value,
        a.new_value,
        a.changed_at,
        a.changed_by,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name
      FROM v4.app_audit_log a
      LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
      WHERE a.source_table = $1
        AND a.record_id = $2
        AND a.business_unit = $3
      ORDER BY a.changed_at DESC
    `;

    const { rows } = await getPool().query(query, [
      sourceTable,
      recordId,
      businessUnit,
    ]);

    res.json(rows);
  } catch (err) {
    console.error("getAuditByRecord Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 2. GET AUDIT LOG BY CHANGED_BY USER
// Usage: GET /audit/user/:userId
// - Officers/Admins only — see all changes made by a specific user
export const getAuditByUser = async (req, res) => {
  const userRole = req.user.userType?.toUpperCase() || "";

  if (!ELEVATED_ROLES.includes(userRole)) {
    return res.status(403).json({ error: "Permission denied" });
  }

  const { userId } = req.params;
  const businessUnit = req.user.business_unit;
  const { source_table, limit = 100, offset = 0 } = req.query;

  try {
    const values = [userId, businessUnit];
    let query = `
      SELECT
        a.audit_id,
        a.source_table,
        a.record_id,
        a.operation,
        a.field_name,
        a.old_value,
        a.new_value,
        a.changed_at,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name
      FROM v4.app_audit_log a
      LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
      WHERE a.changed_by = $1
        AND a.business_unit = $2
    `;

    if (source_table) {
      values.push(source_table);
      query += ` AND a.source_table = $${values.length}`;
    }

    values.push(Number(limit), Number(offset));
    query += ` ORDER BY a.changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("getAuditByUser Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 3. SEARCH AUDIT LOG — General filtered view for audit trail page
// Usage: GET /audit/search
// - Officers/Admins only
// - Filters: source_table, field_name, changed_by, date_from, date_to, user_id
export const searchAuditLog = async (req, res) => {
  const userRole = req.user.userType?.toUpperCase() || "";

  if (!ELEVATED_ROLES.includes(userRole)) {
    return res.status(403).json({ error: "Permission denied" });
  }

  const businessUnit = req.user.business_unit;
  const {
    source_table,
    field_name,
    changed_by,
    user_id,
    date_from,
    date_to,
    limit = 100,
    offset = 0,
  } = req.query;

  try {
    const values = [businessUnit];
    let query = `
      SELECT
        a.audit_id,
        a.source_table,
        a.record_id,
        a.operation,
        a.field_name,
        a.old_value,
        a.new_value,
        a.changed_at,
        a.changed_by,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS changed_by_name,
        a.user_id AS subject_user_id,
        TRIM(CONCAT(s.first_name, ' ', s.last_name)) AS subject_user_name
      FROM v4.app_audit_log a
      LEFT JOIN v4.user_profile_tbl p ON a.changed_by = p.user_id
      LEFT JOIN v4.user_profile_tbl s ON a.user_id = s.user_id
      WHERE a.business_unit = $1
    `;

    if (source_table) {
      values.push(source_table);
      query += ` AND a.source_table = $${values.length}`;
    }

    if (field_name) {
      values.push(field_name);
      query += ` AND a.field_name = $${values.length}`;
    }

    if (changed_by) {
      values.push(changed_by);
      query += ` AND a.changed_by = $${values.length}::uuid`;
    }

    if (user_id) {
      values.push(user_id);
      query += ` AND a.user_id = $${values.length}::uuid`;
    }

    if (date_from) {
      values.push(date_from);
      query += ` AND a.changed_at >= $${values.length}::timestamptz`;
    }

    if (date_to) {
      values.push(date_to);
      query += ` AND a.changed_at <= $${values.length}::timestamptz`;
    }

    values.push(Number(limit), Number(offset));
    query += ` ORDER BY a.changed_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`;

    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("searchAuditLog Error:", err);
    res.status(500).json({ error: err.message });
  }
};
