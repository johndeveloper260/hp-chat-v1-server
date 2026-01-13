import { getPool } from "../config/getPool.js";

/**
 * Get Comments (The missing function)
 */
export const getComments = async (req, res) => {
  const { type, id } = req.params;

  try {
    const query = `
      SELECT 
        c.*, 
        u.email,
        u.business_unit,
        p.first_name,
        p.last_name,
        p.position,
        p.company as user_company,
        -- Construct a full name for the frontend
        CONCAT(p.first_name, ' ', p.last_name) as user_name
      FROM v4.shared_comments c
      -- Join account to get email/unit
      LEFT JOIN v4.user_account_tbl u ON c.user_id = u.id
      -- Join profile to get names and position
      LEFT JOIN v4.user_profile_tbl p ON c.user_id = p.user_id
      WHERE c.relation_type = $1 AND c.relation_id = $2
      ORDER BY c.created_at ASC;
    `;

    const result = await getPool().query(query, [type, id]);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error("Error fetching comments:", error.message);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

/**
 * Add Comment
 */
export const addComment = async (req, res) => {
  const {
    relation_type,
    relation_id,
    content_text,
    parent_comment_id,
    metadata,
  } = req.body;
  const user_id = req.user.id;

  try {
    const query = `
      INSERT INTO v4.shared_comments 
      (relation_type, relation_id, user_id, content_text, parent_comment_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const result = await getPool().query(query, [
      relation_type,
      relation_id,
      user_id,
      content_text,
      parent_comment_id,
      metadata || {},
    ]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Edit Comment
 */
export const editComment = async (req, res) => {
  const { commentId } = req.params;
  const { content_text } = req.body;
  const user_id = req.user.id;

  try {
    const query = `
      UPDATE v4.shared_comments 
      SET content_text = $1, is_edited = TRUE, updated_at = NOW()
      WHERE comment_id = $2 AND user_id = $3
      RETURNING *;
    `;
    const result = await getPool().query(query, [
      content_text,
      commentId,
      user_id,
    ]);

    if (result.rowCount === 0)
      return res.status(403).json({ error: "Unauthorized or not found" });
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete Comment
 */
export const deleteComment = async (req, res) => {
  const { commentId } = req.params;
  const user_id = req.user.id;

  try {
    const query = `DELETE FROM v4.shared_comments WHERE comment_id = $1 AND user_id = $2`;
    const result = await getPool().query(query, [commentId, user_id]);

    if (result.rowCount === 0)
      return res.status(403).json({ error: "Unauthorized" });
    res.json({ message: "Comment deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
