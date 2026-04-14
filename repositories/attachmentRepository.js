/**
 * Attachment Repository
 *
 * Raw SQL for v4.shared_attachments.
 * Every write function accepts an optional `client` for transaction support.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── BU ownership guard ───────────────────────────────────────────────────────

/**
 * Verify a parent record exists and belongs to the given business_unit.
 * Returns rowCount (0 = not found / unauthorized).
 */
export const checkParentBU = async (relationType, relationId, userBU, client, userId = null) => {
  if (relationType === "inquiries") {
    const { rowCount } = await db(client).query(
      "SELECT ticket_id FROM v4.inquiry_tbl WHERE ticket_id = $1 AND business_unit = $2",
      [relationId, userBU],
    );
    return rowCount;
  }
  if (relationType === "announcements") {
    const { rowCount } = await db(client).query(
      "SELECT row_id FROM v4.announcement_tbl WHERE row_id = $1 AND business_unit = $2",
      [relationId, userBU],
    );
    return rowCount;
  }
  if (relationType === "profile") {
    const { rowCount } = await db(client).query(
      "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
      [relationId, userBU],
    );
    return rowCount;
  }
  if (relationType === "return_home") {
    const { rowCount } = await db(client).query(
      "SELECT id FROM v4.return_home_tbl WHERE id = $1 AND business_unit = $2",
      [relationId, userBU],
    );
    return rowCount;
  }
  if (relationType === "task") {
    const { rowCount } = await db(client).query(
      "SELECT id FROM v4.tasks WHERE id = $1::uuid AND business_unit = $2",
      [relationId, userBU],
    );
    return rowCount;
  }
  if (relationType === "subtask") {
    // Verify the task is a subtask and the caller is an assignee
    if (!userId) return 0;
    const { rowCount } = await db(client).query(
      `SELECT t.id
       FROM v4.tasks t
       JOIN v4.task_assignees ta ON ta.task_id = t.id AND ta.user_id = $3::uuid
       WHERE t.id = $1::uuid AND t.business_unit = $2 AND t.parent_task_id IS NOT NULL`,
      [relationId, userBU, userId],
    );
    return rowCount;
  }
  if (relationType === "chat_template") {
    const { rowCount } = await db(client).query(
      "SELECT row_id FROM v4.chat_message_templates WHERE row_id = $1::int AND business_unit = $2 AND deleted_at IS NULL",
      [relationId, userBU],
    );
    return rowCount;
  }
  return 0; // unknown relation type
};

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export const insertSharedAttachment = async (
  { relation_type, relation_id, s3_key, s3_bucket, display_name, file_type, business_unit, created_by },
  client,
) => {
  const { rows } = await db(client).query(
    `INSERT INTO v4.shared_attachments
       (relation_type, relation_id, s3_key, s3_bucket, display_name, file_type, business_unit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [relation_type, relation_id.toString(), s3_key, s3_bucket, display_name, file_type, business_unit, created_by ?? null],
  );
  return rows[0];
};

export const findAttachmentById = async (attachmentId, client) => {
  const { rows } = await db(client).query(
    `SELECT attachment_id, s3_key, s3_bucket, relation_type, relation_id
     FROM v4.shared_attachments
     WHERE attachment_id = $1`,
    [attachmentId],
  );
  return rows[0] ?? null;
};

/**
 * Verify a subtask exists and belongs to the given business_unit (no assignee check).
 * Used when a privileged user (OFFICER/ADMIN) fetches all attachments for a subtask.
 */
export const checkSubtaskExistsBU = async (subtaskId, userBU, client) => {
  return db(client).query(
    `SELECT id FROM v4.tasks
     WHERE id = $1::uuid AND business_unit = $2 AND parent_task_id IS NOT NULL`,
    [subtaskId, userBU],
  );
};

export const findAttachmentsByRelation = async (relationType, relationId, client, userId = null) => {
  const params = [relationType, relationId.toString()];
  let userFilter = "";
  if (relationType === "subtask" && userId) {
    params.push(userId);
    userFilter = ` AND a.created_by = $${params.length}::uuid`;
  }
  const { rows } = await db(client).query(
    `SELECT a.attachment_id, a.relation_type, a.relation_id,
            a.s3_key, a.s3_bucket, a.display_name, a.file_type, a.file_size,
            a.created_at, a.updated_at, a.created_by,
            p.first_name, p.middle_name, p.last_name,
            (
              SELECT pic.attachment_id FROM v4.shared_attachments pic
              WHERE pic.relation_type = 'profile' AND pic.relation_id::text = a.created_by::text
              ORDER BY pic.created_at DESC LIMIT 1
            ) AS profile_pic_id
     FROM v4.shared_attachments a
     LEFT JOIN v4.user_profile_tbl p ON p.user_id = a.created_by
     WHERE a.relation_type = $1 AND a.relation_id = $2${userFilter}
     ORDER BY a.created_at DESC`,
    params,
  );
  return rows;
};

/** Returns all S3 keys + attachment_ids for a given relation (used by cascade deletes). */
export const findAttachmentKeysByRelation = async (relationType, relationId, userBU, client) => {
  const { rows } = await db(client).query(
    `SELECT attachment_id, s3_key
     FROM v4.shared_attachments
     WHERE relation_type = $1 AND relation_id = $2 AND business_unit = $3`,
    [relationType, relationId.toString(), userBU],
  );
  return rows;
};

export const checkAttachmentExists = async (attachmentId, client) => {
  const { rowCount } = await db(client).query(
    `SELECT attachment_id FROM v4.shared_attachments WHERE attachment_id = $1`,
    [attachmentId],
  );
  return rowCount;
};

export const deleteAttachmentById = async (attachmentId, client) => {
  await db(client).query(
    `DELETE FROM v4.shared_attachments WHERE attachment_id = $1`,
    [attachmentId],
  );
};

export const deleteAttachmentsByRelation = async (relationType, relationId, client) => {
  await db(client).query(
    `DELETE FROM v4.shared_attachments WHERE relation_type = $1 AND relation_id = $2`,
    [relationType, relationId.toString()],
  );
};

/** Find the most-recent profile picture for a user (relation_type = 'profile'). */
export const findProfilePicture = async (userId, client) => {
  const { rows } = await db(client).query(
    `SELECT attachment_id, s3_key
     FROM v4.shared_attachments
     WHERE relation_type = 'profile' AND relation_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId.toString()],
  );
  return rows[0] ?? null;
};

/**
 * Rename an attachment (scoped to business_unit).
 * Returns { rows, rowCount } so the caller can detect Forbidden (rowCount = 0).
 */
export const updateAttachmentDisplayName = async (attachmentId, displayName, userBU, client) => {
  const { rows, rowCount } = await db(client).query(
    `UPDATE v4.shared_attachments
     SET display_name = $1, updated_at = NOW()
     WHERE attachment_id = $2 AND business_unit = $3
     RETURNING *`,
    [displayName, attachmentId, userBU],
  );
  return { rows, rowCount };
};
