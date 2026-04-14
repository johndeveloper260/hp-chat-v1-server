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
       p.first_name, p.middle_name, p.last_name, p.position, p.company AS user_company,
       sa.attachment_id AS author_profile_pic_id
     FROM v4.shared_comments c
     LEFT JOIN v4.user_account_tbl u  ON c.user_id = u.id
     LEFT JOIN v4.user_profile_tbl p  ON c.user_id = p.user_id
     LEFT JOIN LATERAL (
       SELECT attachment_id
       FROM v4.shared_attachments
       WHERE relation_type = 'profile' AND relation_id = c.user_id::text
       ORDER BY created_at DESC
       LIMIT 1
     ) sa ON true
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
  const coordRes = await getPool().query(
    `SELECT unnest(c.coordinators) AS user_id
     FROM v4.inquiry_tbl i
     JOIN v4.company_tbl c ON c.company_id = i.company AND c.business_unit = i.business_unit
     WHERE i.ticket_id = $1 AND c.coordinators IS NOT NULL`,
    [relationId],
  );
  recipients.push(...coordRes.rows.map((r) => r.user_id));
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
    `SELECT r.user_id, r.business_unit, p.company
     FROM v4.return_home_tbl r
     JOIN v4.user_profile_tbl p ON p.user_id = r.user_id
     WHERE r.id = $1`,
    [relationId],
  );
  const appRow = appRes.rows[0];
  const recipients = appRow ? [appRow.user_id] : [];

  // Company coordinators for the applicant's company
  if (appRow?.company) {
    const coordRes = await getPool().query(
      `SELECT unnest(coordinators) AS user_id
       FROM v4.company_tbl
       WHERE company_id = $1 AND business_unit = $2 AND coordinators IS NOT NULL`,
      [appRow.company, appRow.business_unit],
    );
    recipients.push(...coordRes.rows.map((r) => r.user_id));
  }

  // Previous commenters on this record
  const prevRes = await getPool().query(
    `SELECT DISTINCT user_id FROM v4.shared_comments
     WHERE relation_type = 'return_home' AND relation_id = $1 AND user_id != $2`,
    [String(relationId), commenterId],
  );
  return [...recipients, ...prevRes.rows.map((r) => r.user_id)];
};

// ── Task-specific helpers ─────────────────────────────────────────────────────

export const checkTaskBU = async (rowId, businessUnit) => {
  const { rowCount } = await getPool().query(
    "SELECT row_id FROM v4.tasks WHERE row_id = $1 AND business_unit = $2",
    [rowId, businessUnit],
  );
  return rowCount > 0;
};

/**
 * Subtask access check: user must be in task_assignees for this subtask.
 * rowId is the integer row_id (used as shared_comments.relation_id).
 */
export const checkSubtaskBU = async (rowId, businessUnit, userId) => {
  const { rowCount } = await getPool().query(
    `SELECT t.row_id
     FROM v4.tasks t
     JOIN v4.task_assignees ta ON ta.task_id = t.id AND ta.user_id = $3::uuid
     WHERE t.row_id = $1 AND t.business_unit = $2 AND t.parent_task_id IS NOT NULL`,
    [rowId, businessUnit, userId],
  );
  return rowCount > 0;
};

/**
 * Returns user_ids of all assignees of a subtask, excluding the commenter.
 * rowId is the integer row_id.
 */
export const findSubtaskRecipients = async (taskRowId, commenterId) => {
  const { rows } = await getPool().query(
    `SELECT ta.user_id
     FROM v4.tasks t
     JOIN v4.task_assignees ta ON ta.task_id = t.id
     WHERE t.row_id = $1
       AND ta.user_id::text != $2::text`,
    [taskRowId, commenterId],
  );
  return rows.map((r) => r.user_id);
};

/**
 * Returns user_ids of all assignees of a subtask (by UUID), excluding uploader.
 * Used for attachment notifications.
 */
export const findSubtaskRecipientsByUUID = async (taskId, uploaderUserId) => {
  const { rows } = await getPool().query(
    `SELECT ta.user_id
     FROM v4.task_assignees ta
     WHERE ta.task_id = $1::uuid
       AND ta.user_id::text != $2::text`,
    [taskId, uploaderUserId],
  );
  return rows.map((r) => r.user_id);
};

/**
 * Returns user_ids of all team members on the task's team, excluding commenterId.
 * taskRowId is the integer row_id (used as shared_comments.relation_id).
 * Returns [] when the task has no team (personal board tasks).
 */
export const findTaskRecipients = async (taskRowId, commenterId) => {
  const { rows } = await getPool().query(
    `SELECT m.user_id
     FROM v4.tasks t
     JOIN v4.task_team_members m ON m.team_id = t.team_id
     WHERE t.row_id = $1
       AND t.team_id IS NOT NULL
       AND m.user_id::text != $2::text`,
    [taskRowId, commenterId],
  );
  return rows.map((r) => r.user_id);
};

/**
 * Same as findTaskRecipients but looks up by UUID id (used for attachment notifications).
 */
export const findTaskRecipientsByUUID = async (taskId, uploaderUserId) => {
  const { rows } = await getPool().query(
    `SELECT m.user_id
     FROM v4.tasks t
     JOIN v4.task_team_members m ON m.team_id = t.team_id
     WHERE t.id = $1::uuid
       AND t.team_id IS NOT NULL
       AND m.user_id::text != $2::text`,
    [taskId, uploaderUserId],
  );
  return rows.map((r) => r.user_id);
};

/** Get task UUID from integer row_id (for comment notifications). */
export const findTaskIdByRowId = async (rowId) => {
  const { rows } = await getPool().query(
    `SELECT id FROM v4.tasks WHERE row_id = $1`,
    [rowId],
  );
  return rows[0]?.id ?? null;
};

/** Get task integer row_id from UUID (for attachment notifications). */
export const findTaskRowIdByUUID = async (taskId) => {
  const { rows } = await getPool().query(
    `SELECT row_id FROM v4.tasks WHERE id = $1::uuid`,
    [taskId],
  );
  return rows[0]?.row_id ?? null;
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
