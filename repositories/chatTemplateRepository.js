/**
 * Chat Template Repository
 *
 * All SQL for chat message template management.
 * Accepts optional `client` for transaction participation.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Reads ─────────────────────────────────────────────────────────────────────

/** Used by the chat sidebar — active templates only, minimal columns. */
export const findAllActive = (businessUnit) =>
  getPool().query(
    `SELECT id, row_id, title, body, category, sort_order
     FROM v4.chat_message_templates
     WHERE business_unit = $1
       AND is_active = true
       AND deleted_at IS NULL
     ORDER BY sort_order ASC, title ASC`,
    [businessUnit],
  );

/** Used by the admin setup page — all non-deleted templates. */
export const findAll = (businessUnit) =>
  getPool().query(
    `SELECT id, row_id, title, body, category, sort_order, is_active, created_at, updated_at
     FROM v4.chat_message_templates
     WHERE business_unit = $1
       AND deleted_at IS NULL
     ORDER BY sort_order ASC, title ASC`,
    [businessUnit],
  );

/** Fetch all attachments for a list of template row_ids in one query. */
export const findAttachmentsByRowIds = (rowIds) => {
  if (!rowIds.length) return Promise.resolve({ rows: [] });
  const placeholders = rowIds.map((_, i) => `$${i + 1}`).join(", ");
  return getPool().query(
    `SELECT attachment_id, relation_id::int AS row_id,
            display_name, file_type, file_size, created_at
     FROM v4.shared_attachments
     WHERE relation_type = 'chat_template'
       AND relation_id::int IN (${placeholders})
     ORDER BY created_at ASC`,
    rowIds,
  );
};

export const findById = (id, businessUnit) =>
  getPool().query(
    `SELECT * FROM v4.chat_message_templates
     WHERE id = $1 AND business_unit = $2 AND deleted_at IS NULL`,
    [id, businessUnit],
  );

// ── Mutations ─────────────────────────────────────────────────────────────────

export const insert = (
  { title, body, category, sort_order, is_active, businessUnit, userId },
  client,
) =>
  db(client).query(
    `INSERT INTO v4.chat_message_templates
       (title, body, category, sort_order, is_active, business_unit, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      title,
      body,
      category ?? null,
      sort_order ?? 0,
      is_active ?? true,
      businessUnit,
      userId,
    ],
  );

export const updateById = (
  id,
  businessUnit,
  { title, body, category, sort_order, is_active },
  userId,
  client,
) =>
  db(client).query(
    `UPDATE v4.chat_message_templates
     SET title = $1,
         body = $2,
         category = $3,
         sort_order = $4,
         is_active = $5,
         last_updated_by = $6,
         updated_at = NOW()
     WHERE id = $7
       AND business_unit = $8
       AND deleted_at IS NULL
     RETURNING *`,
    [title, body, category ?? null, sort_order ?? 0, is_active, userId, id, businessUnit],
  );

export const softDeleteById = (id, businessUnit) =>
  getPool().query(
    `UPDATE v4.chat_message_templates
     SET deleted_at = NOW()
     WHERE id = $1 AND business_unit = $2 AND deleted_at IS NULL`,
    [id, businessUnit],
  );

/**
 * Bulk-updates sort_order for a list of {id, sort_order} pairs.
 * Uses a VALUES list joined back to the table — single round-trip.
 */
export const bulkUpdateSortOrder = (updates, businessUnit, client) => {
  const valuePlaceholders = updates
    .map((_, i) => `($${i * 2 + 1}::uuid, $${i * 2 + 2}::int)`)
    .join(", ");
  const params = updates.flatMap(({ id, sort_order }) => [id, sort_order]);

  return db(client).query(
    `UPDATE v4.chat_message_templates t
     SET sort_order = u.sort_order,
         updated_at = NOW()
     FROM (VALUES ${valuePlaceholders}) AS u(id, sort_order)
     WHERE t.id = u.id
       AND t.business_unit = $${params.length + 1}
       AND t.deleted_at IS NULL`,
    [...params, businessUnit],
  );
};
