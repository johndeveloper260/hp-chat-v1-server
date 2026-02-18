import { getPool } from "../config/getPool.js";
import { deleteFromS3 } from "./attachmentController.js";

const ELEVATED_ROLES = ["OFFICER", "ADMIN"];

// 1. SEARCH — With filters, user profile joins, and business_unit isolation
export const searchReturnHome = async (req, res) => {
  const { company, user_name, flight_date_from, flight_date_to, status } =
    req.query;

  const businessUnit = req.user.business_unit;
  const userId = req.user.id;
  const userRole = req.user.userType?.toUpperCase() || "";

  let query = `
    SELECT
      r.*,
      TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
      p.company AS user_company,
      v.visa_type,
      v.joining_date,
      v.visa_expiry_date,
      (SELECT COUNT(*)
       FROM v4.shared_comments
       WHERE relation_type = 'return_home'
       AND relation_id = r.id::text) AS comment_count,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'attachment_id', attachment_id,
              's3_key', s3_key,
              's3_bucket', s3_bucket,
              'name', display_name,
              'type', file_type
            )
          )
          FROM v4.shared_attachments
          WHERE relation_type = 'return_home'
          AND relation_id = r.id::text
        ), '[]'::json
      ) AS attachments
    FROM v4.return_home_tbl r
    LEFT JOIN v4.user_profile_tbl p ON r.user_id = p.user_id
    LEFT JOIN v4.user_visa_info_tbl v ON r.user_id = v.user_id
    WHERE r.business_unit = $1
  `;

  const values = [businessUnit];

  // Non-elevated users see only their own records
  if (!ELEVATED_ROLES.includes(userRole)) {
    values.push(userId);
    query += ` AND r.user_id = $${values.length}::uuid`;
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
    user_id,
    flight_date,
    return_date,
    route_origin,
    route_destination,
    ticket_type,
    lumpsum_applying,
    tio_jo,
    details,
  } = req.body;

  const creatorId = req.user.id;
  const businessUnit = req.user.business_unit;
  // Officers can create on behalf of another user
  const targetUserId = user_id || creatorId;

  try {
    const query = `
      INSERT INTO v4.return_home_tbl (
        user_id, flight_date, return_date, route_origin, route_destination,
        ticket_type, lumpsum_applying, tio_jo, details,
        business_unit, created_by, updated_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
      RETURNING *;
    `;

    const { rows } = await getPool().query(query, [
      targetUserId,
      flight_date,
      return_date,
      route_origin,
      route_destination,
      ticket_type,
      lumpsum_applying,
      tio_jo,
      details,
      businessUnit,
      creatorId,
    ]);

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error("Create ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// 3. GET SINGLE RECORD — With user profile, visa info, comments & attachments
export const getReturnHomeById = async (req, res) => {
  const { id } = req.params;
  const businessUnit = req.user.business_unit;

  try {
    const mainRes = await getPool().query(
      `SELECT r.*,
        TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS user_name,
        p.first_name, p.last_name, p.company AS user_company,
        v.visa_type, v.joining_date, v.visa_expiry_date
       FROM v4.return_home_tbl r
       LEFT JOIN v4.user_profile_tbl p ON r.user_id = p.user_id
       LEFT JOIN v4.user_visa_info_tbl v ON r.user_id = v.user_id
       WHERE r.id = $1 AND r.business_unit = $2`,
      [id, businessUnit],
    );

    if (mainRes.rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    const attachmentsRes = await getPool().query(
      `SELECT * FROM v4.shared_attachments
       WHERE relation_type = 'return_home' AND relation_id = $1 AND business_unit = $2`,
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
  } = req.body;
  const updatedBy = req.user.id;
  const businessUnit = req.user.business_unit;

  try {
    const query = `
      UPDATE v4.return_home_tbl
      SET flight_date = $1, return_date = $2, route_origin = $3, route_destination = $4,
          ticket_type = $5, lumpsum_applying = $6, tio_jo = $7,
          details = $8, updated_by = $9, updated_at = NOW(),
          user_id = COALESCE($11, user_id)
      WHERE id = $10 AND business_unit = $12
      RETURNING *;
    `;
    const { rows } = await getPool().query(query, [
      flight_date,
      return_date,
      route_origin,
      route_destination,
      ticket_type,
      lumpsum_applying,
      tio_jo,
      details,
      updatedBy,
      id,
      user_id || null,
      businessUnit,
    ]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Record not found" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Update ReturnHome Error:", err);
    res.status(500).json({ error: err.message });
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
      [id, businessUnit],
    );

    // Delete physical S3 files
    for (const row of attachRows.rows) {
      await deleteFromS3(row.s3_key);
    }

    // Cascading purge
    await client.query(
      `DELETE FROM v4.shared_attachments
       WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2`,
      [id, businessUnit],
    );

    await client.query(
      `DELETE FROM v4.shared_comments
       WHERE relation_id = $1::text AND relation_type = 'return_home' AND business_unit = $2`,
      [id, businessUnit],
    );

    await client.query(
      `DELETE FROM v4.notification_history_tbl
       WHERE relation_id = $1 AND relation_type = 'return_home' AND business_unit = $2`,
      [id, businessUnit],
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
