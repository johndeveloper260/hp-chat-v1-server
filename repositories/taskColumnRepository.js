/**
 * Task Column Repository
 *
 * Raw SQL for v4.task_columns.
 * Columns are owner-scoped:
 *   owner_type = 'user' → personal columns (owner_id = user_id)
 *   owner_type = 'team' → team columns     (owner_id = team_id)
 *
 * DB migration required:
 *   ALTER TABLE v4.task_columns ADD COLUMN owner_type VARCHAR(10), ADD COLUMN owner_id UUID;
 *   CREATE INDEX idx_task_columns_owner ON v4.task_columns (owner_type, owner_id);
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

const DEFAULT_COLUMNS = [
  { label: "To Do",       color: "slate",  col_order: 0 },
  { label: "In Progress", color: "blue",   col_order: 1 },
  { label: "Review",      color: "amber",  col_order: 2 },
  { label: "Done",        color: "green",  col_order: 3 },
];

// ─── Read ──────────────────────────────────────────────────────────────────────

export const findColumnsByOwner = async (ownerType, ownerId, bu, client) => {
  const { rows } = await db(client).query(
    `SELECT id, label, color, col_order, business_unit, owner_type, owner_id, created_at
     FROM v4.task_columns
     WHERE owner_type = $1 AND owner_id = $2::uuid AND business_unit = $3
     ORDER BY col_order ASC, created_at ASC`,
    [ownerType, ownerId, bu],
  );
  return rows;
};

export const countColumnsByOwner = async (ownerType, ownerId, bu) => {
  const { rows } = await getPool().query(
    `SELECT COUNT(*) AS cnt FROM v4.task_columns
     WHERE owner_type = $1 AND owner_id = $2::uuid AND business_unit = $3`,
    [ownerType, ownerId, bu],
  );
  return parseInt(rows[0].cnt, 10);
};

export const findColumnById = async (id, bu, client) => {
  const { rows } = await db(client).query(
    `SELECT id, label, color, col_order, business_unit, owner_type, owner_id
     FROM v4.task_columns
     WHERE id = $1::uuid AND business_unit = $2`,
    [id, bu],
  );
  return rows[0] ?? null;
};

// ─── Insert ────────────────────────────────────────────────────────────────────

export const insertColumn = async (
  { label, color, col_order, business_unit, owner_type, owner_id },
  client,
) => {
  const { rows } = await db(client).query(
    `INSERT INTO v4.task_columns (label, color, col_order, business_unit, owner_type, owner_id)
     VALUES ($1, $2, $3, $4, $5, $6::uuid)
     RETURNING id, label, color, col_order, business_unit, owner_type, owner_id, created_at`,
    [label, color, col_order, business_unit, owner_type, owner_id],
  );
  return rows[0];
};

export const insertDefaultColumns = async (ownerType, ownerId, bu, client) => {
  const results = [];
  for (const col of DEFAULT_COLUMNS) {
    const row = await insertColumn(
      { ...col, business_unit: bu, owner_type: ownerType, owner_id: ownerId },
      client,
    );
    results.push(row);
  }
  return results;
};

// ─── Update ────────────────────────────────────────────────────────────────────

export const updateColumn = async (id, { label, color }, ownerType, ownerId, bu, client) => {
  const sets = [];
  const values = [];

  if (label !== undefined) { values.push(label); sets.push(`label = $${values.length}`); }
  if (color !== undefined) { values.push(color); sets.push(`color = $${values.length}`); }

  if (sets.length === 0) return null;

  values.push(id);
  values.push(ownerType);
  values.push(ownerId);
  values.push(bu);

  const idIdx    = values.length - 3;
  const typeIdx  = values.length - 2;
  const ownerIdx = values.length - 1;
  const buIdx    = values.length;

  const { rows } = await db(client).query(
    `UPDATE v4.task_columns
     SET ${sets.join(", ")}
     WHERE id = $${idIdx}::uuid
       AND owner_type = $${typeIdx}
       AND owner_id   = $${ownerIdx}::uuid
       AND business_unit = $${buIdx}
     RETURNING id, label, color, col_order, business_unit, owner_type, owner_id, created_at`,
    values,
  );
  return rows[0] ?? null;
};

export const reorderColumns = async (ids, ownerType, ownerId, bu) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    for (let i = 0; i < ids.length; i++) {
      await client.query(
        `UPDATE v4.task_columns
         SET col_order = $1
         WHERE id = $2::uuid AND owner_type = $3 AND owner_id = $4::uuid AND business_unit = $5`,
        [i, ids[i], ownerType, ownerId, bu],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteColumn = async (id, ownerType, ownerId, bu) => {
  const { rowCount } = await getPool().query(
    `DELETE FROM v4.task_columns
     WHERE id = $1::uuid AND owner_type = $2 AND owner_id = $3::uuid AND business_unit = $4`,
    [id, ownerType, ownerId, bu],
  );
  return rowCount;
};
