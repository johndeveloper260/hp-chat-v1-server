import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

dotenv.config();

/**
 * GET /sending-org/dropdown?country_origin=PH
 * Returns sending orgs filtered by country_origin code
 */
export const getSendingOrgDropdown = async (req, res) => {
  try {
    const { country_origin } = req.query;
    const userBU = req.user.business_unit;

    const query = `
      SELECT code AS value, descr AS label
      FROM v4.sending_org_tbl
      WHERE active = true
        AND ($1::text IS NULL OR country_origin = $1)
        AND business_unit = $2
      ORDER BY sort_order ASC, descr ASC
    `;

    const { rows } = await getPool().query(query, [
      country_origin || null,
      userBU,
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /visa-list/dropdown?lang=en
 * Returns visa list filtered by business_unit and localized description
 */
export const getVisaDropdown = async (req, res) => {
  try {
    const userBU = req.user.business_unit;
    // Default to 'en' if no language is provided
    const lang = req.query.lang || "en";

    // We use ->> to extract the value for the specific language key from the JSONB 'descr'
    // We also use COALESCE to fallback to 'en' if the requested language doesn't exist in that row
    const query = `
      SELECT 
        code AS value, 
        COALESCE(descr->>$1, descr->>'en') AS label
      FROM v4.visa_list_tbl
      WHERE active = true
        AND business_unit = $2
      ORDER BY sort_order ASC, code ASC
    `;

    const { rows } = await getPool().query(query, [lang, userBU]);
    res.json(rows);
  } catch (err) {
    console.error("Visa Dropdown Error:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
