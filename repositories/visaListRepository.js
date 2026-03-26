/**
 * Visa List Repository
 *
 * All SQL for v4.visa_list_tbl.
 */
import { getPool } from "../config/getPool.js";

export const findAllByBU = (businessUnit) =>
  getPool().query(
    `SELECT id, code, descr, active, sort_order, business_unit
     FROM v4.visa_list_tbl
     WHERE business_unit = $1
     ORDER BY sort_order ASC, code ASC`,
    [businessUnit],
  );

export const countByCode = (code, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count FROM v4.visa_list_tbl
     WHERE code = $1 AND business_unit = $2`,
    [code, businessUnit],
  );

export const insertVisaList = ({ code, descr, active, sort_order, businessUnit }) =>
  getPool().query(
    `INSERT INTO v4.visa_list_tbl
       (code, business_unit, descr, active, sort_order)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [code, businessUnit, descr ?? {}, active ?? true, sort_order ?? 1],
  );

export const updateVisaListById = (id, businessUnit, { descr, active, sort_order }) =>
  getPool().query(
    `UPDATE v4.visa_list_tbl
     SET descr = $1, active = $2, sort_order = $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 AND business_unit = $5
     RETURNING *`,
    [descr ?? {}, active ?? true, sort_order ?? 1, id, businessUnit],
  );

export const countUsersWithVisaTypeById = (id, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count
     FROM v4.user_visa_info_tbl vi
     JOIN v4.user_account_tbl a ON a.id = vi.user_id
     JOIN v4.visa_list_tbl vl ON vl.code = vi.visa_type
     WHERE vl.id = $1 AND a.business_unit = $2`,
    [id, businessUnit],
  );

export const deleteVisaListById = (id, businessUnit) =>
  getPool().query(
    `DELETE FROM v4.visa_list_tbl WHERE id = $1 AND business_unit = $2`,
    [id, businessUnit],
  );
