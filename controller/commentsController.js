import { getPool } from "../config/getPool.js";

/**
 * Get Comments
 */
export const getComments = async (req, res) => {
  const { type, id } = req.params;

  try {
    const query = `
      SELECT 
        c.comment_id,
        c.user_id,
        c.content_text,
        c.created_at,
        c.updated_at,
        c.is_edited,
        u.email,
        u.business_unit,
        p.first_name,
        p.last_name,
        p.position,
        p.company as user_company,
        CONCAT(p.first_name, ' ', p.last_name) as user_name
      FROM v4.shared_comments c
      LEFT JOIN v4.user_account_tbl u ON c.user_id = u.id
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

  // Ensure we are getting the ID from the decoded token
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
      parent_comment_id || null,
      metadata || {},
    ]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Add Comment Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Edit Comment
 * Ensures only the owner can edit
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

    if (result.rowCount === 0) {
      return res
        .status(403)
        .json({ error: "Unauthorized or comment not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Edit Comment Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Delete Comment
 * Ensures only the owner (or potentially an admin) can delete
 */
export const deleteComment = async (req, res) => {
  const { commentId } = req.params;
  const user_id = req.user.id;

  try {
    // Note: If you want admins to delete any comment,
    // check req.user.role here and adjust the WHERE clause
    const query = `
      DELETE FROM v4.shared_comments 
      WHERE comment_id = $1 AND user_id = $2
      RETURNING comment_id;
    `;

    const result = await getPool().query(query, [commentId, user_id]);

    if (result.rowCount === 0) {
      return res.status(403).json({ error: "Unauthorized or already deleted" });
    }

    res.json({ message: "Comment deleted successfully", commentId });
  } catch (error) {
    console.error("Delete Comment Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};
