require("dotenv").config();

// Ensure you import your pool and stream client correctly
const { getPool } = require("../config/getPool");

// 1. GET ALL (Full list for management screen)
exports.getCompanies = async (req, res) => {
  try {
    const { rows } = await getPool().query(
      "SELECT * FROM v4.company_tbl ORDER BY created_at DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 2. GET DROPDOWN (Simplified for Pickers)
exports.getCompanyDropdown = async (req, res) => {
  try {
    const { rows } = await getPool().query(
      "SELECT company_id AS value, company_name->>'en' AS label FROM v4.company_tbl WHERE is_active = true ORDER BY label ASC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 3. CREATE
exports.createCompany = async (req, res) => {
  const { company_name, business_unit, website_url } = req.body;
  const userId = req.user.id; // From auth middleware

  try {
    const query = `
      INSERT INTO v4.company_tbl (company_name, business_unit, website_url, last_updated_by)
      VALUES ($1, $2, $3, $4) RETURNING *;
    `;
    const { rows } = await getPool().query(query, [
      company_name,
      business_unit,
      website_url,
      userId,
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. UPDATE
exports.updateCompany = async (req, res) => {
  const { id } = req.params;
  const { company_name, business_unit, website_url, is_active } = req.body;
  const userId = req.user.id;

  try {
    const query = `
      UPDATE v4.company_tbl 
      SET company_name = $1, business_unit = $2, website_url = $3, is_active = $4, 
          last_updated_by = $5, updated_at = NOW()
      WHERE company_id = $6 RETURNING *;
    `;
    const { rows } = await getPool().query(query, [
      company_name,
      business_unit,
      website_url,
      is_active,
      userId,
      id,
    ]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 5. DELETE
exports.deleteCompany = async (req, res) => {
  const { id } = req.params;
  try {
    await getPool().query("DELETE FROM v4.company_tbl WHERE company_id = $1", [
      id,
    ]);
    res.json({ message: "Company deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
