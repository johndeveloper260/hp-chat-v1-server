/**
 * Issue Type Repository
 *
 * All SQL for v4.issue_tbl.
 */
import { getPool } from "../config/getPool.js";

export const findAllByBU = (businessUnit) =>
  getPool().query(
    `SELECT code, descr, active, sort_order, business_unit
     FROM v4.issue_tbl
     WHERE business_unit = $1
     ORDER BY sort_order ASC, code ASC`,
    [businessUnit],
  );

export const countByCode = (code, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count FROM v4.issue_tbl
     WHERE code = $1 AND business_unit = $2`,
    [code, businessUnit],
  );

export const insertIssueType = ({ code, descr, active, sort_order, businessUnit, userId }) =>
  getPool().query(
    `INSERT INTO v4.issue_tbl
       (code, business_unit, descr, active, sort_order, last_updated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [code, businessUnit, descr ?? {}, active ?? true, sort_order ?? 0, userId ?? null],
  );

export const updateIssueTypeByCode = (code, businessUnit, { descr, active, sort_order }, userId) =>
  getPool().query(
    `UPDATE v4.issue_tbl
     SET descr = $1, active = $2, sort_order = $3,
         last_updated_by = $4, updated_at = CURRENT_TIMESTAMP
     WHERE code = $5 AND business_unit = $6
     RETURNING *`,
    [descr ?? {}, active ?? true, sort_order ?? 0, userId ?? null, code, businessUnit],
  );

export const countInquiriesByType = (code, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count
     FROM v4.inquiry_tbl
     WHERE type = $1 AND business_unit = $2`,
    [code, businessUnit],
  );

export const deleteIssueTypeByCode = (code, businessUnit) =>
  getPool().query(
    `DELETE FROM v4.issue_tbl WHERE code = $1 AND business_unit = $2`,
    [code, businessUnit],
  );
