import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

dotenv.config();

/**
 * POST /announcements
 * Create a new announcement
 */
export const createAnnouncement = async (req, res) => {
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

/**
 * GET /announcements
 * Fetch all active announcements with attachments
 */
export const getAnnouncements = async (req, res) => {
  const { company_filter } = req.query;
  const { id: userId, business_unit: userBU } = req.user;

  let query = `
    SELECT 
      a.row_id,
      a.business_unit,
      a.company as company_ids,
      ARRAY(
        SELECT c.company_name 
        FROM v4.company_tbl c 
        WHERE c.company_id = ANY(a.company::uuid[]) 
      ) as company_names,
      a.title,
      a.content_text,
      a.reactions,
      a.date_from,
      a.date_to,
      a.active,
      a.comments_on,
      a.created_by,
      to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at,
      u.first_name || ' ' || u.last_name as author_name,
      COALESCE(
        (
          SELECT json_agg(att)
          FROM (
            SELECT 
              attachment_id, 
              s3_key,
              s3_bucket,
              display_name as name,
              file_type as type
            FROM v4.shared_attachments
            WHERE relation_type = 'announcements' 
              AND relation_id = a.row_id::text
          ) att
        ), '[]'
      ) as attachments
    FROM v4.announcement_tbl a
    LEFT JOIN v4.user_profile_tbl u ON a.created_by = u.user_id
    WHERE a.active = true 
      AND (a.date_to IS NULL OR a.date_to >= CURRENT_DATE)
  `;

  const values = [];
  if (company_filter) {
    query += ` AND $1 = ANY(a.company::uuid[])`;
    values.push(company_filter);
  }

  if (userBU) {
    values.push(userBU);
    query += ` AND business_unit = $${values.length}`;
  }

  query += ` ORDER BY a.created_at DESC`;

  try {
    const { rows } = await getPool().query(query, values);
    res.json(rows);
  } catch (err) {
    console.error("Database Error:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * PUT /announcements/:id
 * Update an existing announcement
 */
export const updateAnnouncement = async (req, res) => {
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

// feedController.js
/**
 * Toggle Reaction
 */
export const toggleReaction = async (req, res) => {
  const { rowId } = req.params; // Correctly matches router /:rowId/react
  const { emoji } = req.body;
  const userId = String(req.user.id); // Ensure userId is a string for JSONB comparison

  const allowedEmojis = ["👍", "❤️", "😄", "😮", "😢", "🔥"];
  if (!allowedEmojis.includes(emoji)) {
    return res.status(400).json({ error: "Invalid emoji" });
  }

  try {
    // We use JSONB path logic to toggle the userId inside the specific emoji array
    const query = `
      UPDATE v4.announcement_tbl
      SET reactions = CASE
        -- If the user already reacted with THIS specific emoji, remove them
        WHEN reactions->($1::text) @> jsonb_build_array($2::text)
        THEN jsonb_set(
          reactions, 
          ARRAY[$1::text], 
          (reactions->($1::text)) - ($2::text)
        )
        -- Otherwise, add the user to that emoji's array (creating the array if it doesn't exist)
        ELSE jsonb_set(
          reactions, 
          ARRAY[$1::text], 
          COALESCE(reactions->($1::text), '[]'::jsonb) || jsonb_build_array($2::text)
        )
      END
      WHERE row_id = $3 -- Corrected from comment_id
      RETURNING reactions;
    `;

    const result = await getPool().query(query, [emoji, userId, rowId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Announcement not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Toggle Reaction Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};
