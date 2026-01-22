import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";
import { log } from "node:console";

dotenv.config();

export const searchInquiries = async (req, res) => {
  const {
    status,
    type,
    lang = "en",
    company_id,
    assigned_to,
    high_pri,
  } = req.query;

  const businessUnit = req.user.business_unit;

  let query = `
  SELECT 
  i.*, 
  -- 1. Dynamic Company Name based on $1 (lang)
  COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
  
  -- 2. Dynamic Issue Type Description based on $1 (lang)
  COALESCE(iss.descr->>$1, iss.descr->>'en', 'General Inquiry') AS type_name,

  -- Resolve User Names
  TRIM(CONCAT(u_assign.first_name, ' ', u_assign.last_name)) AS assigned_to_name,
  TRIM(CONCAT(u_owner.first_name, ' ', u_owner.last_name)) AS owner_name,
  TRIM(CONCAT(u_open.first_name, ' ', u_open.last_name)) AS opened_by_name,
  TRIM(CONCAT(u_upd.first_name, ' ', u_upd.last_name)) AS last_updated_by_name,
  
  -- Resolve Watcher Names
  (SELECT STRING_AGG(TRIM(CONCAT(first_name, ' ', last_name)), ', ') 
   FROM v4.user_profile_tbl 
   WHERE user_id = ANY(i.watcher)) AS watcher_names

   COALESCE(
        (
          SELECT json_agg(att)
          FROM (
            SELECT attachment_id, s3_key, s3_bucket, display_name as name, file_type as type
            FROM v4.shared_attachments
            WHERE relation_type = 'inquiries' AND relation_id = a.row_id::text
          ) att
        ), '[]'
      ) as attachments

FROM v4.inquiry_tbl i
-- Joins
LEFT JOIN v4.company_tbl c ON i.company = c.company_id
LEFT JOIN v4.issue_tbl iss ON i.type = iss.code AND i.business_unit = iss.business_unit
LEFT JOIN v4.user_profile_tbl u_assign ON i.assigned_to = u_assign.user_id
LEFT JOIN v4.user_profile_tbl u_owner ON i.owner_id = u_owner.user_id
LEFT JOIN v4.user_profile_tbl u_open ON i.opened_by = u_open.user_id
LEFT JOIN v4.user_profile_tbl u_upd ON i.last_updated_by = u_upd.user_id

-- Filter by Business Unit ($2)
WHERE i.business_unit = $2
  `;

  const values = [lang, businessUnit];

  // --- STATUS FILTER LOGIC ---
  if (status && status !== "All") {
    values.push(status);
    query += ` AND i.status = $${values.length}`;
  } else if (!status || status === "All") {
    // DEFAULT BEHAVIOR: If no specific status is requested, hide Closed/Hold
    // This allows "All" to mean "All relevant/active"
    query += ` AND i.status NOT IN ('Completed', 'Hold')`;
  }

  // --- NEW FILTERS ---
  if (company_id && company_id !== "null") {
    values.push(company_id);
    query += ` AND i.company = $${values.length}`;
  }

  if (assigned_to && assigned_to !== "null") {
    values.push(assigned_to);
    query += ` AND i.assigned_to = $${values.length}::uuid`;
  }

  if (high_pri === "true" || high_pri === true) {
    query += ` AND i.high_pri = true`;
  }

  query += ` ORDER BY i.last_update_dttm DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Search Inquiries Error:", err);
    res.status(500).json({ error: "Search failed" });
  }
};

// 2. CREATE
export const createInquiry = async (req, res) => {
  const { id: userId, business_unit: userBU } = req.user;
  const {
    company,
    title,
    description,
    occur_date,
    type,
    high_pri,
    watcher,
    owner_id,
    opened_by,
  } = req.body;

  const query = `
    INSERT INTO v4.inquiry_tbl (
      business_unit, company, title, description, 
      occur_date, type, high_pri, watcher,
      opened_by, owner_id, status, open_dt,
      last_updated_by, last_update_dttm
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8::uuid[], 
      $9::uuid, $10::uuid, 'New', CURRENT_DATE,
      $9::uuid, NOW()
    ) RETURNING *;
  `;

  try {
    const values = [
      userBU,
      company,
      title,
      description,
      occur_date,
      type,
      high_pri,
      watcher || [],
      opened_by,
      owner_id || userId,
    ];
    const { rows } = await getPool().query(query, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 3. UPDATE
export const updateInquiry = async (req, res) => {
  const { ticketId } = req.params;
  const userId = req.user.id;

  const {
    status,
    assigned_to,
    resolution,
    description,
    high_pri,
    watcher,
    closed_dt,
  } = req.body;

  const query = `
    UPDATE v4.inquiry_tbl
    SET 
      status = $1,
      assigned_to = $2::uuid,
      resolution = $3,
      description = $4,
      high_pri = $5,
      watcher = $6::uuid[],
      closed_dt = $7,
      last_updated_by = $8::uuid,
      last_update_dttm = NOW()
    WHERE ticket_id = $9
    RETURNING *;
  `;

  try {
    const values = [
      status,
      assigned_to,
      resolution,
      description,
      high_pri,
      watcher,
      closed_dt,
      userId,
      ticketId,
    ];
    const { rows } = await getPool().query(query, values);
    if (rows.length === 0)
      return res.status(404).json({ error: "Ticket not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// 4. DELETE
export const deleteInquiry = async (req, res) => {
  const { ticketId } = req.params;
  try {
    const { rowCount } = await getPool().query(
      "DELETE FROM v4.inquiry_tbl WHERE ticket_id = $1",
      [ticketId],
    );
    if (rowCount === 0)
      return res.status(404).json({ error: "Ticket not found" });
    res.json({ message: "Inquiry deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

//5. GET ISSUE TYPE
export const getIssues = async (req, res) => {
  const { lang = "en" } = req.query;
  const bu = req.user.business_unit; // Extracted from JWT

  try {
    const query = `
      SELECT 
        code AS value, 
        COALESCE(descr->>$1, descr->>'en', code) AS label,
        active
      FROM v4.issue_tbl
      WHERE business_unit = $2 AND active = true
      ORDER BY sort_order ASC
    `;
    const { rows } = await getPool().query(query, [lang, bu]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

//6. GET Officer
export const getOfficersByBU = async (req, res) => {
  try {
    // 1. Extract BU from JWT (Decoded by your 'auth' middleware)
    const bu = req.user.business_unit;

    if (!bu) {
      return res
        .status(400)
        .json({ error: "Business Unit missing from user token" });
    }

    // 2. The JOIN logic is correct based on your schema:
    // Profile has name/type, Account has BU/active status
    const query = `
    SELECT 
        p.user_id AS value, 
        p.first_name || ' ' || p.last_name AS label
    FROM v4.user_profile_tbl p
    JOIN v4.user_account_tbl a ON p.user_id = a.id
    WHERE a.business_unit = $1 
      AND p.user_type = 'OFFICER'
      AND a.is_active = true
    ORDER BY p.first_name ASC
    `;

    const { rows } = await getPool().query(query, [bu]);

    // 3. Return 'rows' or an empty array [] if no officers found
    res.status(200).json(rows || []);
  } catch (error) {
    console.error("Backend Error (getOfficersByBU):", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
