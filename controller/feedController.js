require("dotenv").config();

// Ensure you import your pool and stream client correctly
const { getPool } = require("../config/getPool");

// POST /announcements
exports.createAnnouncement = async (req, res) => {
  const {
    business_unit,
    company,
    title,
    content_text,
    datefrom,
    dateto,
    active,
    comments_on,
    created_by,
  } = req.body;

  const query = `
    INSERT INTO v4.announcement_tbl (
      business_unit, company, title, content_text, 
      datefrom, dateto, active, comments_on, 
      created_by, created_dttm, last_updated_by, last_updated_dt
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), $9, NOW())
    RETURNING *;
  `;

  try {
    const values = [
      business_unit,
      company,
      title,
      content_text,
      datefrom,
      dateto,
      active,
      comments_on,
      created_by,
    ];
    const { rows } = await getPool().query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// GET /announcements
exports.getAnnouncements = async (req, res) => {
  const { company_filter } = req.query;

  let query = `
    SELECT * FROM v4.announcement_tbl 
    WHERE active = true 
    AND (dateto IS NULL OR dateto >= CURRENT_DATE)
  `;

  const values = [];
  if (company_filter) {
    // Uses the ANY operator to check if the filter exists in the company text[] array
    query += ` AND $1 = ANY(company)`;
    values.push(company_filter);
  }

  query += ` ORDER BY created_dttm DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// PUT /announcements/:id
exports.updateAnnouncement = async (req, res) => {
  const { id } = req.params;
  const {
    business_unit,
    company,
    title,
    content_text,
    datefrom,
    dateto,
    active,
    comments_on,
    updated_by,
  } = req.body;

  const query = `
    UPDATE v4.announcement_tbl 
    SET 
      business_unit = $1, company = $2, title = $3, 
      content_text = $4, datefrom = $5, dateto = $6, 
      active = $7, comments_on = $8, 
      last_updated_by = $9, last_updated_dt = NOW()
    WHERE row_id = $10
    RETURNING *;
  `;

  try {
    const values = [
      business_unit,
      company,
      title,
      content_text,
      datefrom,
      dateto,
      active,
      comments_on,
      updated_by,
      id,
    ];
    const { rows } = await getPool().query(query, values);

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
