require("dotenv").config();

// Ensure you import your pool and stream client correctly
const { getPool } = require("../config/getPool");

// POST /announcements
exports.createAnnouncement = async (req, res) => {
  // 1. Get user data from the middleware (req.user)
  const { id: userId, business_unit: userBU } = req.user;

  const {
    company,
    title,
    content_text,
    date_from,
    date_to,
    active,
    comments_on,
  } = req.body;

  const query = `
    INSERT INTO v4.announcement_tbl (
      business_unit, company, title, content_text, 
      date_from, date_to, active, comments_on, 
      created_by, created_at, last_updated_by, last_updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid, NOW(), $9::uuid, NOW())
    RETURNING *;
  `;

  try {
    const values = [
      userBU,
      company,
      title,
      content_text,
      date_from,
      date_to,
      active,
      comments_on,
      userId,
    ];
    const { rows } = await getPool().query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/// GET /announcements
exports.getAnnouncements = async (req, res) => {
  const { company_filter } = req.query;

  // 1. We join with the users table to get the creator's name
  // 2. We use to_char to force an ISO 8601 format (YYYY-MM-DDTHH:MM:SSZ)
  //    This prevents the "NaN" error in React Native Hermes/Mobile engines.
  let query = `
    SELECT 
      a.row_id,
      a.business_unit,
      a.company,
      a.title,
      a.content_text,
      a.date_from,
      a.date_to,
      a.active,
      a.comments_on,
      a.created_by,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
      u.first_name || ' ' || u.last_name as author_name
    FROM v4.announcement_tbl a
    LEFT JOIN v4.user_profile_tbl u ON a.created_by = u.user_id
    WHERE a.active = true 
    AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)
  `;

  const values = [];
  if (company_filter) {
    query += ` AND $1 = ANY(a.company)`;
    values.push(company_filter);
  }

  // Note: Updated to your actual column name 'created_at'
  query += ` ORDER BY a.created_at DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// PUT /announcements/:id
exports.updateAnnouncement = async (req, res) => {
  const { rowId } = req.params;
  const {
    company,
    title,
    content_text,
    date_from,
    date_to,
    active,
    comments_on,
    updated_by,
  } = req.body;

  const query = `
    UPDATE v4.announcement_tbl 
    SET 
       company = $1, title = $2, 
      content_text = $3, date_from = $4, date_to = $5, 
      active = $6, comments_on = $7, 
      last_updated_by = $8, last_updated_at = NOW()
    WHERE row_id = $9
    RETURNING *;
  `;

  try {
    const values = [
      company,
      title,
      content_text,
      date_from,
      date_to,
      active,
      comments_on,
      updated_by,
      rowId,
    ];
    const { rows } = await getPool().query(query, values);

    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
