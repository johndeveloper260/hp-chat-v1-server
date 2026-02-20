import { getPool } from "../config/getPool.js";
import { deleteFromS3 } from "./attachmentController.js";

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];

// 1. SEARCH — With filters, user profile joins, and business_unit isolation
export const searchReturnHome = async (req, res) => {
  const { company, user_name, status, is_resignation, is_paid_leave, flight_date_from, flight_date_to } =
    req.query;

  const businessUnit = req.user.business_unit;
  const userId = req.user.id;
  const userRole = req.user.userType?.toUpperCase() || "";
  const lang = req.user.preferred_language || "en";

  let query = `
    SELECT
      r.*,
      TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
      p.company AS user_company_id,
      -- NEW: Extract the company name from JSONB based on user language
      COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
      v.visa_type,
      v.joining_date,
      v.visa_expiry_date,
      (SELECT COUNT(*)
       FROM v4.shared_comments
       WHERE relation_type = 'return_home'
       AND relation_id = r.id) AS comment_count,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'attachment_id', attachment_id,
              'name', display_name,
              'type', file_type
            )
          )
          FROM v4.shared_attachments
          WHERE relation_type = 'return_home'
          AND relation_id = r.id::text
        ), '[]'
      ) AS attachments
    FROM v4.return_home_tbl r
    LEFT JOIN v4.user_profile_tbl p ON r.user_id = p.user_id
    -- NEW JOIN: Linking profile company (ID) to company table
    LEFT JOIN v4.company_tbl c ON p.company = c.company_id::text
    LEFT JOIN v4.user_visa_info_tbl v ON r.user_id = v.user_id
    WHERE r.business_unit = $2
  `;

  const values = [lang, businessUnit];

  if (status) query += ` AND r.status = '${status}'`;
  if (is_resignation !== undefined)
    query += ` AND r.is_resignation = ${is_resignation}`;
  if (is_paid_leave !== undefined)
    query += ` AND r.is_paid_leave = ${is_paid_leave}`;

  // Non-elevated users see only their own records
  if (!ELEVATED_ROLES.includes(userRole)) {
    values.push(userId);
    // query += ` AND r.user_id = $${values.length}::uuid`;
    query += ` AND r.user_id::uuid = $${values.length}::uuid`;
  }

  // Filter: company (text match on user_profile company field)
  if (company && company !== "") {
    values.push(company);
    query += ` AND p.company = $${values.length}`;
  }

  // Filter: user name (partial match)
  if (user_name && user_name !== "") {
    values.push(`%${user_name}%`);
    query += ` AND (p.first_name ILIKE $${values.length} OR p.last_name ILIKE $${values.length})`;
  }

  // Filter: flight date range
  if (flight_date_from) {
    values.push(flight_date_from);
    query += ` AND r.flight_date >= $${values.length}::date`;
  }
  if (flight_date_to) {
    values.push(flight_date_to);
    query += ` AND r.flight_date <= $${values.length}::date`;
  }

  // Filter: dynamic status (computed from dates)
  if (status && status !== "All") {
    if (status === "Upcoming") {
      query += ` AND r.flight_date > CURRENT_DATE`;
    } else if (status === "Out of Country") {
      query += ` AND r.flight_date <= CURRENT_DATE AND (r.return_date IS NULL OR r.return_date >= CURRENT_DATE)`;
    } else if (status === "Returned") {
      query += ` AND r.return_date < CURRENT_DATE`;
    }
  }

  query += ` ORDER BY r.created_at DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Search ReturnHome Error:", err);
    res.status(500).json({ error: "Search failed" });
  }
};

// 2. CREATE
export const createReturnHome = async (req, res) => {
  const {
    flight_date,
    return_date,
    route_origin,
    route_destination,
    ticket_type,
    lumpsum_applying,
    details,
    tio_jo,
    is_resignation,
    is_paid_leave,
    status, // status can be 'Draft' or 'Pending'
    user_id, // Officers can pass a target user_id
  } = req.body;

  const creatorId = req.user.id;
  const businessUnit = req.user.business_unit;
  // Officers can create on behalf of another user
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const targetUserId = (user_id && UUID_RE.test(user_id)) ? user_id : creatorId;

  try {
    const query = `
      INSERT INTO v4.return_home_tbl (
        user_id, business_unit, flight_date, return_date,
        route_origin, route_destination, ticket_type,
        lumpsum_applying, details, tio_jo,
        is_resignation, is_paid_leave, status,
        created_by, updated_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
      RETURNING id;
    `;

    const { rows } = await getPool().query(query, [
      targetUserId,
      businessUnit,
      flight_date || null,
      return_date || null,
      route_origin || null,
      route_destination || null,
      ticket_type || null,
      lumpsum_applying,
      details || null,
      tio_jo || null,
      is_resignation ?? false,
      is_paid_leave ?? false,
      status || "Draft",
      creatorId,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 3. GET SINGLE RECORD — Updated with Company Name and Preferred Language
export const getReturnHomeById = async (req, res) => {
  const { id } = req.params;
  const businessUnit = req.user.business_unit;

  // Extract preferred language from auth middleware, defaulting to 'en'
  const lang = req.user.preferred_language || "en";

  try {
    const mainRes = await getPool().query(
      `SELECT 
        r.*,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
        p.first_name, 
        p.last_name, 
        p.company AS user_company_id,
        -- Fetch localized company name with fallback logic
        COALESCE(c.company_name->>$1, c.company_name->>'en', 'N/A') AS company_name_text,
        v.visa_type, 
        v.joining_date, 
        v.visa_expiry_date
       FROM v4.return_home_tbl r
       LEFT JOIN v4.user_profile_tbl p ON r.user_id = p.user_id
       -- Join company table using the company ID from profile
       LEFT JOIN v4.company_tbl c ON p.company = c.company_id::text
       LEFT JOIN v4.user_visa_info_tbl v ON r.user_id = v.user_id
       WHERE r.id = $2 AND r.business_unit = $3`,
      [lang, id, businessUnit],
    );

    if (mainRes.rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    const attachmentsRes = await getPool().query(
      `SELECT 
        attachment_id, 
        display_name as name, 
        file_type as type, 
        s3_key, 
        s3_bucket 
       FROM v4.shared_attachments
       WHERE relation_type = 'return_home' 
       AND relation_id = $1::text 
       AND business_unit = $2`,
      [id, businessUnit],
    );

    res.json({
      ...mainRes.rows[0],
      attachments: attachmentsRes.rows,
    });
  } catch (err) {
    console.error("Get ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 4. UPDATE
export const updateReturnHome = async (req, res) => {
  const { id } = req.params;
  const {
    flight_date,
    return_date,
    route_origin,
    route_destination,
    ticket_type,
    lumpsum_applying,
    tio_jo,
    details,
    user_id,
    is_resignation,
    is_paid_leave,
    status,
  } = req.body;
  const updatedBy = req.user.id;
  const businessUnit = req.user.business_unit;

  try {
    // Validate user_id is a proper UUID or null
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const safeUserId = user_id && UUID_RE.test(String(user_id).trim()) ? String(user_id).trim() : null;

    console.log("[updateReturnHome] user_id from body:", JSON.stringify(user_id), "-> safeUserId:", safeUserId);

    const query = safeUserId
      ? `UPDATE v4.return_home_tbl
         SET flight_date = $1, return_date = $2,
             route_origin = $3, route_destination = $4,
             ticket_type = $5, lumpsum_applying = $6, tio_jo = $7,
             details = $8, is_resignation = $9,
             is_paid_leave = $10, status = $11,
             updated_by = $12, updated_at = NOW(),
             user_id = $13
         WHERE id = $14 AND business_unit = $15
         RETURNING *;`
      : `UPDATE v4.return_home_tbl
         SET flight_date = $1, return_date = $2,
             route_origin = $3, route_destination = $4,
             ticket_type = $5, lumpsum_applying = $6, tio_jo = $7,
             details = $8, is_resignation = $9,
             is_paid_leave = $10, status = $11,
             updated_by = $12, updated_at = NOW()
         WHERE id = $13 AND business_unit = $14
         RETURNING *;`;

    const values = safeUserId
      ? [
          flight_date || null,
          return_date || null,
          route_origin || null,
          route_destination || null,
          ticket_type || null,
          lumpsum_applying,
          tio_jo || null,
          details || null,
          is_resignation ?? false,
          is_paid_leave ?? false,
          status || null,
          updatedBy,
          safeUserId,
          id,
          businessUnit,
        ]
      : [
          flight_date || null,
          return_date || null,
          route_origin || null,
          route_destination || null,
          ticket_type || null,
          lumpsum_applying,
          tio_jo || null,
          details || null,
          is_resignation ?? false,
          is_paid_leave ?? false,
          status || null,
          updatedBy,
          id,
          businessUnit,
        ];

    const { rows } = await getPool().query(query, values);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Update ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 4.1. NEW: APPROVE/REJECT - Officer Action
export const approveReturnHome = async (req, res) => {
  const { id } = req.params;
  const { status, approver_remarks } = req.body; // status: 'Approved' or 'Rejected'
  const userRole = req.user.userType?.toUpperCase() || "";

  if (!ELEVATED_ROLES.includes(userRole)) {
    return res
      .status(403)
      .json({ message: "Permission denied. Only officers can approve." });
  }

  const client = await getPool().connect();
  try {
    const query = `
      UPDATE v4.return_home_tbl
      SET 
        status = $1,
        approver_remarks = $2,
        approved_by = $3,
        approved_at = now(),
        updated_at = now(),
        updated_by = $3
      WHERE id = $4 AND business_unit = $5
    `;

    await client.query(query, [
      status,
      approver_remarks,
      req.user.id,
      id,
      req.user.business_unit,
    ]);

    res.json({ success: true, message: `Application ${status} successfully` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
};

// 5. DELETE — Atomic cascading deletion with S3 cleanup
export const deleteReturnHome = async (req, res) => {
  const { id } = req.params;
  const businessUnit = req.user.business_unit;

  const client = await getPool().connect();

  try {
    await client.query("BEGIN");

    // Verify existence with business_unit isolation
    const checkRes = await client.query(
      `SELECT id FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2`,
      [id, businessUnit],
    );

    if (checkRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Record not found" });
    }

    // Fetch S3 keys for cleanup
    const attachRows = await client.query(
      `SELECT s3_key FROM v4.shared_attachments
       WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2`,
      [String(id), businessUnit],
    );

    // Delete physical S3 files
    for (const row of attachRows.rows) {
      await deleteFromS3(row.s3_key);
    }

    // Cascading purge (pass String(id) to avoid type-cast mismatches)
    await client.query(
      `DELETE FROM v4.shared_comments
       WHERE relation_id = $1
         AND relation_type = 'return_home'
         AND business_unit = $2`,
      [String(id), businessUnit],
    );

    await client.query(
      `DELETE FROM v4.shared_attachments
       WHERE relation_id = $1
         AND relation_type = 'return_home'
         AND business_unit = $2`,
      [String(id), businessUnit],
    );

    await client.query(
      `DELETE FROM v4.notification_history_tbl
       WHERE relation_id = $1
         AND relation_type = 'return_home'
         AND business_unit = $2`,
      [String(id), businessUnit],
    );

    // Delete the parent record
    await client.query(
      `DELETE FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2`,
      [id, businessUnit],
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Return home record and all related data deleted successfully",
    });
  } catch (err) {
    if (client) await client.query("ROLLBACK");
    console.error("Delete ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
};
