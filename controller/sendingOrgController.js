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

    const query = `
      SELECT code AS value, descr AS label
      FROM v4.sending_org_tbl
      WHERE active = true
        AND ($1::text IS NULL OR country_origin = $1)
      ORDER BY sort_order ASC, descr ASC
    `;

    const { rows } = await getPool().query(query, [country_origin || null]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
