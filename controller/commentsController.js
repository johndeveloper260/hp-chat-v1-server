import { getPool } from "../config/getPool.js";
import { createNotification } from "./notificationController.js";

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
 * Add Comment with Notifications
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
    // 1. Insert the comment
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

    const newComment = result.rows[0];

    // 2. Fetch the commenter's name for the notification body
    const commenterQuery = await getPool().query(
      `SELECT first_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1`,
      [user_id],
    );
    const commenterName = commenterQuery.rows[0]
      ? `${commenterQuery.rows[0].first_name} ${commenterQuery.rows[0].last_name}`
      : "Someone";

    // 3. Identify recipients based on relation_type
    let recipients = [];

    if (relation_type === "announcements") {
      // Notify the creator of the announcement
      const announcement = await getPool().query(
        `SELECT created_by FROM v4.announcement_tbl WHERE id = $1`,
        [relation_id],
      );
      if (announcement.rows[0]) {
        recipients.push(announcement.rows[0].created_by);
      }
    } else if (relation_type === "inquiries") {
      // Notify owner, assignee, and watchers
      const inquiry = await getPool().query(
        `SELECT owner_id, assigned_to, watcher FROM v4.inquiry_tbl WHERE ticket_id = $1`,
        [relation_id],
      );
      if (inquiry.rows[0]) {
        const { owner_id, assigned_to, watcher } = inquiry.rows[0];
        recipients = [owner_id, assigned_to, ...(watcher || [])];
      }
    }

    // 4. Filter: Remove nulls, duplicates, and DO NOT notify self
    const finalRecipients = [...new Set(recipients)].filter(
      (id) => id && id !== user_id,
    );

    // 5. Send Notifications
    if (finalRecipients.length > 0) {
      const notifTitle = `New comment on ${relation_type === "inquiries" ? "Inquiry" : "Announcement"}`;
      const notifBody = `${commenterName}: "${content_text.substring(0, 50)}${content_text.length > 50 ? "..." : ""}"`;

      await Promise.all(
        finalRecipients.map((recipientId) =>
          createNotification({
            userId: recipientId,
            title: notifTitle,
            body: notifBody,
            data: {
              type: relation_type,
              rowId: relation_id,
              // Map to the correct screen based on type
              screen: relation_type === "inquiries" ? "Inquiry" : "Home",
              params:
                relation_type === "inquiries"
                  ? { ticketId: relation_id }
                  : { rowId: relation_id },
            },
          }),
        ),
      );
    }

    res.status(201).json(newComment);
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
  const userRole = req.user.userType?.toUpperCase() || "";

  try {
    let query;
    let params;

    // Check if the user is an officer (or admin)
    if (userRole === "OFFICER" || userRole === "ADMIN") {
      // Officers can delete by ID only (ignoring ownership)
      query = `
        DELETE FROM v4.shared_comments 
        WHERE comment_id = $1
        RETURNING comment_id;
      `;
      params = [commentId];
    } else {
      // Regular users must own the comment
      query = `
        DELETE FROM v4.shared_comments 
        WHERE comment_id = $1 AND user_id = $2
        RETURNING comment_id;
      `;
      params = [commentId, user_id];
    }

    const result = await getPool().query(query, params);

    if (result.rowCount === 0) {
      // If it's 0, it either doesn't exist or they aren't authorized
      return res
        .status(403)
        .json({ error: "Unauthorized or comment not found" });
    }

    res.json({ message: "Comment deleted successfully", commentId });
  } catch (error) {
    console.error("Delete Comment Error:", error.message);
    res.status(500).json({ error: error.message });
  }
};
