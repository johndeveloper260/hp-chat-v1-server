/**
 * Sending Organisation Repository
 *
 * All SQL for sending orgs and visa type lookups.
 */
import { getPool } from "../config/getPool.js";

export const findSendingOrgs = (countryOrigin, businessUnit) =>
  getPool().query(
    `SELECT code AS value, descr AS label
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
