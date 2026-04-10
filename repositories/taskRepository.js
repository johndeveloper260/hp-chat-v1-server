/**
 * Task Repository
 *
 * Raw SQL for v4.tasks and v4.task_assignees.
 * Write functions that participate in transactions accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── List ──────────────────────────────────────────────────────────────────────

/**
 * findTasks — returns tasks with assignees array, comment_count, attachment_count.
 * filters: { column_id?, team_id?, category?, assignee_id?, userOnly?, userId? }
 * userOnly=true restricts to tasks created by or assigned to userId.
 */
export const findTasks = async (bu, filters = {}) => {
  const { column_id, team_id, category, assignee_id, userOnly, userId, personalOnly } = filters;

  const values = [bu];
  let query = `
    SELECT
      t.id,
      t.row_id,
      t.title,
      t.description,
      t.category,
      t.column_id,
      t.deadline,
      t.remind_at,
      t.created_by,
      t.team_id,
      t.business_unit,
      t.col_order,
      t.created_at,
      t.updated_at,
      p_creator.first_name AS creator_first_name,
      p_creator.middle_name AS creator_middle_name,
      p_creator.last_name AS creator_last_name,
      creator_pic.attachment_id AS creator_pic_id,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'user_id', ta.user_id,
              'first_name', up.first_name,
              'middle_name', up.middle_name,
              'last_name', up.last_name,
              'profile_pic_id', (
                SELECT attachment_id FROM v4.shared_attachments
                WHERE relation_type = 'profile' AND relation_id::text = ta.user_id::text
                ORDER BY created_at DESC LIMIT 1
              )
            ) ORDER BY up.first_name ASC
          )
          FROM v4.task_assignees ta
          JOIN v4.user_profile_tbl up ON ta.user_id = up.user_id
          WHERE ta.task_id = t.id
        ),
        '[]'::json
      ) AS assignees,
      (
        SELECT COUNT(*)
        FROM v4.shared_comments
        WHERE relation_type = 'task' AND relation_id::text = t.id::text
      )::int AS comment_count,
      (
        SELECT COUNT(*)
        FROM v4.shared_attachments
        WHERE relation_type = 'task' AND relation_id::text = t.id::text
      )::int AS attachment_count
    FROM v4.tasks t
    LEFT JOIN v4.user_profile_tbl p_creator ON t.created_by = p_creator.user_id
    LEFT JOIN LATERAL (
      SELECT attachment_id FROM v4.shared_attachments
      WHERE relation_type = 'profile' AND relation_id::text = t.created_by::text
      ORDER BY created_at DESC LIMIT 1
    ) creator_pic ON true
    WHERE t.business_unit = $1
  `;

  if (column_id) {
    values.push(column_id);
    query += ` AND t.column_id = $${values.length}::uuid`;
  }

  if (team_id) {
    values.push(team_id);
    query += ` AND t.team_id = $${values.length}::uuid`;
  }

  if (category) {
    values.push(category);
    query += ` AND t.category = $${values.length}`;
  }

  if (assignee_id) {
    values.push(assignee_id);
    query += ` AND EXISTS (
      SELECT 1 FROM v4.task_assignees ta2
      WHERE ta2.task_id = t.id AND ta2.user_id = $${values.length}::uuid
    )`;
  }

  if (personalOnly) {
    query += ` AND t.team_id IS NULL`;
  }

  if (userOnly && userId) {
    values.push(userId);
    query += ` AND (
      t.created_by = $${values.length}::uuid
      OR EXISTS (
        SELECT 1 FROM v4.task_assignees ta3
        WHERE ta3.task_id = t.id AND ta3.user_id = $${values.length}::uuid
      )
      OR (
        t.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM v4.task_team_members htm
          WHERE htm.team_id = t.team_id AND htm.user_id = $${values.length}::uuid
        )
      )
    )`;
  }

  query += ` ORDER BY t.col_order ASC, t.created_at DESC`;

  const { rows } = await getPool().query(query, values);
  return rows;
};

// ─── Single Task ───────────────────────────────────────────────────────────────

export const findTaskById = async (id, bu, client) => {
  const { rows } = await db(client).query(
    `SELECT
       t.id,
       t.row_id,
       t.title,
       t.description,
       t.category,
       t.column_id,
       t.deadline,
       t.remind_at,
       t.created_by,
       t.team_id,
       t.business_unit,
       t.col_order,
       t.created_at,
       t.updated_at,
       p_creator.first_name AS creator_first_name,
       p_creator.middle_name AS creator_middle_name,
       p_creator.last_name AS creator_last_name,
       creator_pic.attachment_id AS creator_pic_id,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'user_id', ta.user_id,
               'first_name', up.first_name,
               'middle_name', up.middle_name,
               'last_name', up.last_name,
               'profile_pic_id', (
                 SELECT attachment_id FROM v4.shared_attachments
                 WHERE relation_type = 'profile' AND relation_id::text = ta.user_id::text
                 ORDER BY created_at DESC LIMIT 1
               )
             ) ORDER BY up.first_name ASC
           )
           FROM v4.task_assignees ta
           JOIN v4.user_profile_tbl up ON ta.user_id = up.user_id
           WHERE ta.task_id = t.id
         ),
         '[]'::json
       ) AS assignees,
       (
         SELECT COUNT(*)
         FROM v4.shared_comments
         WHERE relation_type = 'task' AND relation_id::text = t.id::text
       )::int AS comment_count,
       (
         SELECT COUNT(*)
         FROM v4.shared_attachments
         WHERE relation_type = 'task' AND relation_id::text = t.id::text
       )::int AS attachment_count
     FROM v4.tasks t
     LEFT JOIN v4.user_profile_tbl p_creator ON t.created_by = p_creator.user_id
     LEFT JOIN LATERAL (
       SELECT attachment_id FROM v4.shared_attachments
       WHERE relation_type = 'profile' AND relation_id::text = t.created_by::text
       ORDER BY created_at DESC LIMIT 1
     ) creator_pic ON true
     WHERE t.id = $1::uuid AND t.business_unit = $2`,
    [id, bu],
  );
  return rows[0] ?? null;
};

// ─── Check access ──────────────────────────────────────────────────────────────

export const isUserRelatedToTask = async (taskId, userId) => {
  const { rows } = await getPool().query(
    `SELECT
       (t.created_by = $2::uuid) AS is_creator,
       EXISTS (
         SELECT 1 FROM v4.task_assignees ta
         WHERE ta.task_id = t.id AND ta.user_id = $2::uuid
       ) AS is_assignee,
       (
         t.team_id IS NOT NULL AND EXISTS (
           SELECT 1 FROM v4.task_team_members htm
           WHERE htm.team_id = t.team_id AND htm.user_id = $2::uuid
         )
       ) AS is_team_member
     FROM v4.tasks t
     WHERE t.id = $1::uuid`,
    [taskId, userId],
  );
  return rows[0] ?? null;
};

// ─── Insert ────────────────────────────────────────────────────────────────────

export const insertTask = async (data, client) => {
  const {
    title, description, category, column_id, deadline,
    remind_at, created_by, team_id, business_unit, col_order,
  } = data;

  const { rows } = await db(client).query(
    `INSERT INTO v4.tasks
       (title, description, category, column_id, deadline, remind_at,
        created_by, team_id, business_unit, col_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10)
     RETURNING *`,
    [
      title,
      description ?? null,
      category ?? null,
      column_id ?? null,
      deadline ?? null,
      remind_at ?? null,
      created_by,
      team_id ?? null,
      business_unit,
      col_order ?? 0,
    ],
  );
  return rows[0];
};

// ─── Assignees ─────────────────────────────────────────────────────────────────

export const insertTaskAssignees = async (taskId, userIds, client) => {
  if (!userIds || userIds.length === 0) return;
  const placeholders = userIds.map((_, i) => `($1::uuid, $${i + 2}::uuid)`).join(", ");
  await db(client).query(
    `INSERT INTO v4.task_assignees (task_id, user_id)
     VALUES ${placeholders}
     ON CONFLICT (task_id, user_id) DO NOTHING`,
    [taskId, ...userIds],
  );
};

export const deleteTaskAssignees = async (taskId, client) => {
  await db(client).query(
    `DELETE FROM v4.task_assignees WHERE task_id = $1::uuid`,
    [taskId],
  );
};

// ─── Update ────────────────────────────────────────────────────────────────────

export const updateTask = async (id, data, bu, client) => {
  const allowed = ["title", "description", "category", "column_id", "deadline", "remind_at", "team_id", "col_order"];
  const sets = [];
  const values = [];

  for (const key of allowed) {
    if (key in data) {
      values.push(data[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);
  values.push(bu);

  const { rows } = await db(client).query(
    `UPDATE v4.tasks
     SET ${sets.join(", ")}
     WHERE id = $${values.length - 1}::uuid AND business_unit = $${values.length}
     RETURNING *`,
    values,
  );
  return rows[0] ?? null;
};

export const moveTask = async (id, columnId, colOrder, bu, client) => {
  const { rows } = await db(client).query(
    `UPDATE v4.tasks
     SET column_id = $1, col_order = $2, updated_at = NOW()
     WHERE id = $3::uuid AND business_unit = $4
     RETURNING *`,
    [columnId ?? null, colOrder ?? 0, id, bu],
  );
  return rows[0] ?? null;
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteTask = async (id, bu, client) => {
  const { rowCount } = await db(client).query(
    `DELETE FROM v4.tasks WHERE id = $1::uuid AND business_unit = $2`,
    [id, bu],
  );
  return rowCount;
};
