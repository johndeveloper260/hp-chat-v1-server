/**
 * Comments Repository
 *
 * All raw SQL for v4.shared_comments plus parent-record BU ownership
 * checks for "inquiries" and "announcements" relation types.
 */
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

// ── Parent record BU checks ───────────────────────────────────────────────────

export const checkInquiryBU = async (id, businessUnit) => {
  const { rowCount } = await getPool().query(
    "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
    [id, businessUnit],
  );
  return rowCount > 0;
};

export const checkAnnouncementBU = async (id, businessUnit) => {
  const { rowCount } = await getPool().query(
    "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
    [id, businessUnit],
  );
  return rowCount > 0;
};

export const checkReturnHomeBU = async (id, businessUnit) => {
  const { rowCount } = await getPool().query(
    "SELECT id FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2",
    [id, businessUnit],
  );
  return rowCount > 0;
};

// ── Fetch comments ────────────────────────────────────────────────────────────

export const findComments = async (type, id) => {
  const { rows } = await getPool().query(
    `SELECT
       c.comment_id, c.user_id, c.content_text, c.created_at,
       c.updated_at, c.is_edited,
       u.email, u.business_unit,
       p.first_name, p.middle_name, p.last_name, p.position, p.company AS user_company
     FROM v4.shared_comments c
     LEFT JOIN v4.user_account_tbl u  ON c.user_id = u.id
     LEFT JOIN v4.user_profile_tbl p  ON c.user_id = p.user_id
     WHERE c.relation_type = $1 AND c.relation_id = $2
     ORDER BY c.created_at ASC`,
    [type, id],
  );
  return rows.map((r) => ({ ...r, user_name: formatDisplayName(r.last_name, r.first_name, r.middle_name) }));
};

// ── Insert comment ────────────────────────────────────────────────────────────

export const insertComment = async ({
  relation_type,
  relation_id,
  user_id,
  content_text,
  parent_comment_id,
  metadata,
  businessUnit,
}) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.shared_comments
       (relation_type, relation_id, user_id, content_text, parent_comment_id, metadata, business_unit)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      relation_type,
      relation_id,
      user_id,
      content_text,
      parent_comment_id || null,
      metadata || {},
      businessUnit,
    ],
  );
  return rows[0];
};

// ── Commenter display name ─────────────────────────────────────────────────────

export const findCommenterName = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT first_name, middle_name, last_name FROM v4.user_profile_tbl WHERE user_id = $1",
    [userId],
  );
  return rows[0] ? formatDisplayName(rows[0].last_name, rows[0].first_name, rows[0].middle_name) : "Someone";
};

// ── Recipient resolution ──────────────────────────────────────────────────────

export const findInquiryRecipients = async (relationId, commenterId) => {
  const inquiryRes = await getPool().query(
    "SELECT owner_id, assigned_to, watcher FROM v4.inquiry_tbl WHERE ticket_id = $1",
    [relationId],
  );
  let recipients = [];
  if (inquiryRes.rows[0]) {
    const { owner_id, assigned_to, watcher } = inquiryRes.rows[0];
    recipients.push(owner_id, assigned_to, ...(watcher || []));
  }
  const prevRes = await getPool().query(
    `SELECT DISTINCT user_id FROM v4.shared_comments
     WHERE relation_type = 'inquiries' AND relation_id = $1 AND user_id != $2`,
    [relationId, commenterId],
  );
  return [...recipients, ...prevRes.rows.map((r) => r.user_id)];
};

export const findAnnouncementRecipients = async (relationId, commenterId) => {
  const annRes = await getPool().query(
    "SELECT created_by FROM v4.announcement_tbl WHERE row_id = $1",
    [relationId],
  );
  let recipients = [];
  if (annRes.rows[0]) recipients.push(annRes.rows[0].created_by);
  const prevRes = await getPool().query(
    `SELECT DISTINCT user_id FROM v4.shared_comments
     WHERE relation_type = 'announcements' AND relation_id = $1 AND user_id != $2`,
    [relationId, commenterId],
  );
  return [...recipients, ...prevRes.rows.map((r) => r.user_id)];
};

export const findReturnHomeRecipients = async (relationId, commenterId) => {
  // Applicant on the record
  const appRes = await getPool().query(
    "SELECT user_id FROM v4.return_home_tbl WHERE id = $1",
    [relationId],
  );
  const recipients = appRes.rows[0] ? [appRes.rows[0].user_id] : [];

  // Officers with flight_read or flight_write in the record's BU
  const officerRes = await getPool().query(
    `SELECT DISTINCT a.id AS user_id
     FROM v4.return_home_tbl r
     JOIN v4.user_account_tbl a ON a.business_unit = r.business_unit
     JOIN v4.user_profile_tbl p ON p.user_id = a.id
     WHERE r.id = $1
       AND p.user_type = 'OFFICER'
       AND a.is_active = true
       AND EXISTS (
         SELECT 1 FROM v4.user_roles ur
         WHERE ur.user_id = a.id
           AND ur.role_name IN ('flight_read', 'flight_write')
       )`,
    [relationId],
  );
  recipients.push(...officerRes.rows.map((r) => r.user_id));

  // Previous commenters on this record
  const prevRes = await getPool().query(
    `SELECT DISTINCT user_id FROM v4.shared_comments
     WHERE relation_type = 'return_home' AND relation_id = $1 AND user_id != $2`,
    [String(relationId), commenterId],
  );
  return [...recipients, ...prevRes.rows.map((r) => r.user_id)];
};

// ── Edit ──────────────────────────────────────────────────────────────────────

export const checkCommentExists = async (commentId) => {
  const { rowCount } = await getPool().query(
    "SELECT comment_id FROM v4.shared_comments WHERE comment_id = $1",
    [commentId],
  );
  return rowCount > 0;
};

/** Returns { row, updated } — updated is false when ownership/BU check fails. */
export const updateComment = async (commentId, userId, businessUnit, content_text) => {
  const { rows, rowCount } = await getPool().query(
    `UPDATE v4.shared_comments
     SET content_text = $1, is_edited = TRUE, updated_at = NOW()
     WHERE comment_id = $2 AND user_id = $3 AND business_unit = $4
     RETURNING *`,
    [content_text, commentId, userId, businessUnit],
  );
  return { row: rows[0] ?? null, updated: rowCount > 0 };
};

// ── Delete ────────────────────────────────────────────────────────────────────

/** Returns the relation_type and relation_id of a comment (for BU gate on delete). */
export const findCommentRelation = async (commentId) => {
  const { rows, rowCount } = await getPool().query(
    "SELECT relation_type, relation_id FROM v4.shared_comments WHERE comment_id = $1",
    [commentId],
  );
  return rowCount > 0 ? rows[0] : null;
};

export const deleteCommentAsOwner = async (commentId, userId) => {
  const { rowCount } = await getPool().query(
    "DELETE FROM v4.shared_comments WHERE comment_id = $1 AND user_id = $2 RETURNING comment_id",
    [commentId, userId],
  );
  return rowCount;
};

export const deleteCommentAsOfficer = async (commentId) => {
  const { rowCount } = await getPool().query(
    "DELETE FROM v4.shared_comments WHERE comment_id = $1 RETURNING comment_id",
    [commentId],
  );
  return rowCount;
};
