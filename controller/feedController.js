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
  const { rowId } = req.params;
  const { emoji } = req.body;
  const userId = String(req.user.id);

  try {
    // 1. Fetch current reactions
    const result = await getPool().query(
      "SELECT reactions FROM v4.announcement_tbl WHERE row_id = $1",
      [rowId]
    );

    if (result.rowCount === 0)
      return res.status(404).json({ error: "Not found" });

    // Reactions is an object: { "👍": ["ID1"], "❤️": ["ID2"] }
    let reactions = result.rows[0].reactions || {};

    // 2. Remove this user's ID from EVERY emoji category first
    // This enforces the "Only One Reaction" rule
    Object.keys(reactions).forEach((key) => {
      reactions[key] = reactions[key].filter((id) => id !== userId);
      // Clean up empty arrays to keep DB small
      if (reactions[key].length === 0) delete reactions[key];
    });

    // 3. If the new emoji is NOT the one they just removed, add it
    // (This handles the "toggle off" if they click the same emoji twice)
    const alreadyHadThisEmoji =
      result.rows[0].reactions?.[emoji]?.includes(userId);

    if (!alreadyHadThisEmoji) {
      if (!reactions[emoji]) reactions[emoji] = [];
      reactions[emoji].push(userId);
    }

    // 4. Update Database
    await getPool().query(
      "UPDATE v4.announcement_tbl SET reactions = $1 WHERE row_id = $2",
      [JSON.stringify(reactions), rowId]
    );

    res.json({ success: true, reactions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
