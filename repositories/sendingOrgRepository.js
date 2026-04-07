/**
 * Sending Organisation Repository
 *
 * All SQL for sending orgs and visa type lookups.
 */
import { getPool } from "../config/getPool.js";

// ── Dropdown (existing) ────────────────────────────────────────────────────────

export const findSendingOrgs = (countryOrigin, businessUnit) =>
  getPool().query(
    `SELECT code AS value, descr AS label, country_origin
     FROM v4.sending_org_tbl
     WHERE active = true
       AND ($1::text IS NULL OR country_origin = $1)
       AND business_unit = $2
     ORDER BY sort_order ASC, descr ASC`,
    [countryOrigin || null, businessUnit],
  );

export const findVisaList = (lang, businessUnit) =>
  getPool().query(
    `SELECT code AS value,
            COALESCE(descr->>$1, descr->>'en') AS label
     FROM v4.visa_list_tbl
     WHERE active = true AND business_unit = $2
     ORDER BY sort_order ASC, code ASC`,
    [lang, businessUnit],
  );

// ── CRUD reads ─────────────────────────────────────────────────────────────────

export const findAllByBU = (businessUnit) =>
  getPool().query(
    `SELECT code, descr, active, country_origin, msgnbr, msgset, sort_order, business_unit
     FROM v4.sending_org_tbl
     WHERE business_unit = $1
     ORDER BY sort_order ASC, code ASC`,
    [businessUnit],
  );

export const countByCode = (code, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count FROM v4.sending_org_tbl
     WHERE code = $1 AND business_unit = $2`,
    [code, businessUnit],
  );

// ── CRUD mutations ─────────────────────────────────────────────────────────────

export const insertSendingOrg = ({ code, descr, active, country_origin, msgnbr, msgset, sort_order, businessUnit }) =>
  getPool().query(
    `INSERT INTO v4.sending_org_tbl
       (code, business_unit, descr, active, country_origin, msgnbr, msgset, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [code, businessUnit, descr ?? null, active ?? true, country_origin ?? null, msgnbr ?? null, msgset ?? null, sort_order ?? 0],
  );

export const updateSendingOrgByCode = (code, businessUnit, { descr, active, country_origin, msgnbr, msgset, sort_order }) =>
  getPool().query(
    `UPDATE v4.sending_org_tbl
     SET descr = $1, active = $2, country_origin = $3,
         msgnbr = $4, msgset = $5, sort_order = $6
     WHERE code = $7 AND business_unit = $8
     RETURNING *`,
    [descr ?? null, active ?? true, country_origin ?? null, msgnbr ?? null, msgset ?? null, sort_order ?? 0, code, businessUnit],
  );

export const countProfilesBySendingOrg = (code, businessUnit) =>
  getPool().query(
    `SELECT COUNT(*) AS count
     FROM v4.user_profile_tbl
     WHERE sending_org = $1 AND business_unit = $2`,
    [code, businessUnit],
  );

export const deleteSendingOrgByCode = (code, businessUnit) =>
  getPool().query(
    `DELETE FROM v4.sending_org_tbl WHERE code = $1 AND business_unit = $2`,
    [code, businessUnit],
  );
