import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

import { getUserLanguage } from "../utils/getUserLanguage.js";

dotenv.config();

// 1. GET ALL COMPANIES (Filtered by Business Unit)
export const getCompanies = async (req, res) => {
  try {
    const business_unit = req.user.business_unit;

    const query = `
      SELECT * FROM v4.company_tbl
      WHERE business_unit = $1
      ORDER BY sort_order ASC, label ASC
    `;

    const { rows } = await getPool().query(query, [business_unit]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 2. GET DROPDOWN (Filtered by Business Unit)
export const getCompanyDropdown = async (req, res) => {
  try {
    const business_unit = req.user.business_unit;
    const preferredLanguage = await getUserLanguage(req.user.id);

    const query = `
      SELECT company_id AS value, 
      COALESCE(company_name->>$2, company_name->>'en') AS label
      FROM v4.company_tbl
      WHERE is_active = true
      AND business_unit = $1
      ORDER BY sort_order ASC, label ASC
    `;

    const values = [business_unit, preferredLanguage];

    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 3. CREATE
export const createCompany = async (req, res) => {
  const { company_name, website_url } = req.body;
  const business_unit = req.user.business_unit;
  const userId = req.user.id;

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    // 1. Insert the new company
    const companyQuery = `
      INSERT INTO v4.company_tbl (company_name, business_unit, website_url, last_updated_by)
      VALUES ($1, $2, $3, $4) 
      RETURNING *;
    `;
    const companyRes = await client.query(companyQuery, [
      company_name,
      business_unit,
      website_url,
      userId,
    ]);

    const newCompanyId = companyRes.rows[0].company_id;

    // 2. Populate xref table with 3 rows (USER, OFFICER, ADMIN)
    // We use a single multi-row INSERT query for efficiency
    const xrefQuery = `
      INSERT INTO v4.customer_xref_tbl (business_unit, role_name, company)
      VALUES 
        ($1, 'USER', $2),
        ($1, 'OFFICER', $2),
        ($1, 'ADMIN', $2)
      RETURNING *;
    `;
    const xrefRes = await client.query(xrefQuery, [
      business_unit,
      newCompanyId,
    ]);

    await client.query("COMMIT");

    // Return the company and the newly generated codes
    res.status(201).json({
      company: companyRes.rows[0],
      registration_codes: xrefRes.rows,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Creation Error:", err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
};

// 4. UPDATE
export const updateCompany = async (req, res) => {
  const { id } = req.params;
  const { company_name, website_url, is_active } = req.body;
  const business_unit = req.user.business_unit;
  const userId = req.user.id;

  try {
    const query = `
      UPDATE v4.company_tbl
      SET company_name = $1, website_url = $2, is_active = $3,
          last_updated_by = $4, updated_at = NOW()
      WHERE company_id = $5 AND business_unit = $6 RETURNING *;
    `;
    const { rows } = await getPool().query(query, [
      company_name,
      website_url,
      is_active,
      userId,
      id,
      business_unit,
    ]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 5. DELETE
export const deleteCompany = async (req, res) => {
  const { id } = req.params;
  const business_unit = req.user.business_unit;
  try {
    const { rowCount } = await getPool().query(
      "DELETE FROM v4.company_tbl WHERE company_id = $1 AND business_unit = $2",
      [id, business_unit],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Company not found" });
    res.json({ message: "Company deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 6. GET EMPLOYEES BY COMPANY (Filtered by Officer's Business Unit)
export const getEmployeesByCompany = async (req, res) => {
  const { companyId } = req.params;
  const officerBusinessUnit = req.user.business_unit;

  try {
    const query = `
      SELECT 
        a.id, 
        p.first_name, 
        p.last_name, 
        (p.first_name || ' ' || p.last_name) AS full_name,
        a.email
      FROM v4.user_account_tbl a
      JOIN v4.user_profile_tbl p ON a.id = p.user_id
      WHERE p.company = $1 
        AND a.business_unit = $2
      ORDER BY p.first_name ASC;
    `;

    const { rows } = await getPool().query(query, [
      companyId,
      officerBusinessUnit,
    ]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
