/**
 * Task Repository
 *
 * Raw SQL for v4.tasks and v4.task_assignees.
 * Write functions that participate in transactions accept an optional `client`.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── Shared assignee sub-select (reused in multiple queries) ──────────────────

const assigneesSubselect = `
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
  ) AS assignees
`;

// ─── List (Kanban board — parent tasks only) ──────────────────────────────────

/**
 * findTasks — returns parent tasks (parent_task_id IS NULL) for the Kanban board.
 * Sub-tasks are intentionally excluded from this query.
 * filters: { column_id?, team_id?, category?, assignee_id?, userOnly?, userId?, personalOnly? }
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
      t.source_message_id,
      t.source_channel_id,
      p_creator.first_name AS creator_first_name,
      p_creator.middle_name AS creator_middle_name,
      p_creator.last_name AS creator_last_name,
      creator_pic.attachment_id AS creator_pic_id,
      ${assigneesSubselect},
      (
        SELECT COUNT(*)
        FROM v4.shared_comments
        WHERE relation_type = 'task' AND relation_id::integer = t.row_id
      )::int AS comment_count,
      (
        SELECT COUNT(*)
        FROM v4.shared_attachments
        WHERE relation_type = 'task' AND relation_id = t.id::text
      )::int AS attachment_count,
      (
        SELECT COUNT(*)::int FROM v4.tasks st WHERE st.parent_task_id = t.id
      ) AS subtask_count,
      (
        SELECT COUNT(*)::int FROM v4.tasks st
        WHERE st.parent_task_id = t.id AND st.completed_at IS NOT NULL
      ) AS subtask_completed_count
    FROM v4.tasks t
    LEFT JOIN v4.user_profile_tbl p_creator ON t.created_by = p_creator.user_id
    LEFT JOIN LATERAL (
      SELECT attachment_id FROM v4.shared_attachments
      WHERE relation_type = 'profile' AND relation_id::text = t.created_by::text
      ORDER BY created_at DESC LIMIT 1
    ) creator_pic ON true
    WHERE t.business_unit = $1
      AND t.parent_task_id IS NULL
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

// ─── Single Task (with subtasks + completion %) ───────────────────────────────

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
       t.parent_task_id,
       t.completed_at,
       t.completed_by,
       t.source_message_id,
       t.source_channel_id,
       p_creator.first_name AS creator_first_name,
       p_creator.middle_name AS creator_middle_name,
       p_creator.last_name AS creator_last_name,
       creator_pic.attachment_id AS creator_pic_id,
       ${assigneesSubselect},
       (
         SELECT COUNT(*)
         FROM v4.shared_comments
         WHERE relation_type = 'task' AND relation_id::integer = t.row_id
       )::int AS comment_count,
       (
         SELECT COUNT(*)
         FROM v4.shared_attachments
         WHERE relation_type = 'task' AND relation_id = t.id::text
       )::int AS attachment_count,
       (
         SELECT COUNT(*)::int FROM v4.tasks st WHERE st.parent_task_id = t.id
       ) AS subtask_count,
       (
         SELECT COUNT(*)::int FROM v4.tasks st
         WHERE st.parent_task_id = t.id AND st.completed_at IS NOT NULL
       ) AS subtask_completed_count,
       CASE
         WHEN (SELECT COUNT(*) FROM v4.tasks st WHERE st.parent_task_id = t.id) = 0 THEN NULL
         ELSE ROUND(
           (SELECT COUNT(*)::numeric FROM v4.tasks st WHERE st.parent_task_id = t.id AND st.completed_at IS NOT NULL)
           / (SELECT COUNT(*)::numeric FROM v4.tasks st WHERE st.parent_task_id = t.id)
           * 100
         )
       END AS completion_percentage,
       COALESCE(
         (
           SELECT json_agg(
             json_build_object(
               'id', st.id,
               'title', st.title,
               'description', st.description,
               'deadline', st.deadline,
               'completed_at', st.completed_at,
               'completed_by', st.completed_by,
               'created_at', st.created_at,
               'assignees', COALESCE(
                 (
                   SELECT json_agg(json_build_object(
                     'user_id', ta.user_id,
                     'first_name', up.first_name,
                     'middle_name', up.middle_name,
                     'last_name', up.last_name,
                     'profile_pic_id', (
                       SELECT attachment_id FROM v4.shared_attachments
                       WHERE relation_type = 'profile' AND relation_id::text = ta.user_id::text
                       ORDER BY created_at DESC LIMIT 1
                     )
                   ) ORDER BY up.first_name ASC)
                   FROM v4.task_assignees ta
                   JOIN v4.user_profile_tbl up ON ta.user_id = up.user_id
                   WHERE ta.task_id = st.id
                 ),
                 '[]'::json
               )
             ) ORDER BY st.created_at ASC
           )
           FROM v4.tasks st
           WHERE st.parent_task_id = t.id
         ),
         '[]'::json
       ) AS subtasks
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

// ─── Sub-tasks ─────────────────────────────────────────────────────────────────

export const findSubtasksByParent = async (parentId, bu) => {
  const { rows } = await getPool().query(
    `SELECT
       t.id,
       t.row_id,
       t.title,
       t.description,
       t.deadline,
       t.completed_at,
       t.completed_by,
       t.created_at,
       t.parent_task_id,
       t.business_unit,
       ${assigneesSubselect}
     FROM v4.tasks t
     WHERE t.parent_task_id = $1::uuid AND t.business_unit = $2
     ORDER BY t.created_at ASC`,
    [parentId, bu],
  );
  return rows;
};

/**
 * findMySubtasks — all sub-tasks assigned to a specific user (for RN App).
 * Returns subtask + parent task title for context.
 */
export const findMySubtasks = async (userId, bu) => {
  const { rows } = await getPool().query(
    `SELECT
       t.id,
       t.row_id,
       t.title,
       t.description,
       t.deadline,
       smc.completed_at,
       smc.user_id AS completed_by,
       t.created_at,
       t.updated_at,
       t.parent_task_id,
       t.business_unit,
       pt.title AS parent_task_title,
       p_creator.first_name AS creator_first_name,
       p_creator.last_name  AS creator_last_name
     FROM v4.tasks t
     JOIN v4.task_assignees ta ON ta.task_id = t.id AND ta.user_id = $1::uuid
     JOIN v4.tasks pt ON pt.id = t.parent_task_id
     LEFT JOIN v4.user_profile_tbl p_creator ON pt.created_by = p_creator.user_id
     LEFT JOIN v4.subtask_member_completions smc ON smc.subtask_id = t.id AND smc.user_id = $1::uuid
     WHERE t.parent_task_id IS NOT NULL
     ORDER BY
       smc.completed_at IS NOT NULL ASC,
       t.deadline ASC NULLS LAST,
       t.created_at DESC`,
    [userId],
  );
  return rows;
};

/**
 * completeSubtask — toggles per-user completion in subtask_member_completions.
 * Returns the task row with the calling user's completed_at overlaid.
 */
export const completeSubtask = async (taskId, userId, bu, client) => {
  // Verify the task exists and is a subtask in this business unit.
  const { rows: taskRows } = await db(client).query(
    `SELECT id, parent_task_id, title FROM v4.tasks
     WHERE id = $1::uuid AND business_unit = $2 AND parent_task_id IS NOT NULL`,
    [taskId, bu],
  );
  if (!taskRows[0]) return null;

  // Check if this user already has a completion record.
  const { rows: existing } = await db(client).query(
    `SELECT id FROM v4.subtask_member_completions
     WHERE subtask_id = $1::uuid AND user_id = $2::uuid`,
    [taskId, userId],
  );

  let completedAt = null;
  if (existing[0]) {
    // Already completed — toggle off.
    await db(client).query(
      `DELETE FROM v4.subtask_member_completions
       WHERE subtask_id = $1::uuid AND user_id = $2::uuid`,
      [taskId, userId],
    );
  } else {
    // Not yet completed — mark complete.
    const { rows: inserted } = await db(client).query(
      `INSERT INTO v4.subtask_member_completions (subtask_id, user_id)
       VALUES ($1::uuid, $2::uuid)
       RETURNING completed_at`,
      [taskId, userId],
    );
    completedAt = inserted[0]?.completed_at ?? null;
  }

  // Return the task row with this user's completion state attached.
  return { ...taskRows[0], completed_at: completedAt, completed_by: completedAt ? userId : null };
};

/**
 * getParentProgress — returns total/completed subtask counts for a parent.
 */
export const getParentProgress = async (parentId, bu) => {
  const { rows } = await getPool().query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE completed_at IS NOT NULL)::int AS completed
     FROM v4.tasks
     WHERE parent_task_id = $1::uuid AND business_unit = $2`,
    [parentId, bu],
  );
  return rows[0] ?? { total: 0, completed: 0 };
};

// ─── User search for subtask assignee picker ──────────────────────────────────

export const searchTaskUsers = async (bu, filters = {}) => {
  const { user_type, country, sending_org, company, batch_no, search } = filters;
  const values = [bu];
  const parts  = [];

  if (user_type) {
    values.push(user_type.toUpperCase());
    parts.push(`AND UPPER(p.user_type) = $${values.length}`);
  }
  if (country) {
    values.push(country);
    parts.push(`AND p.country = $${values.length}`);
  }
  if (sending_org) {
    values.push(sending_org);
    parts.push(`AND p.sending_org = $${values.length}`);
  }
  if (company) {
    values.push(company);
    parts.push(`AND p.company::text = $${values.length}`);
  }
  if (batch_no) {
    values.push(batch_no);
    parts.push(`AND p.batch_no = $${values.length}`);
  }
  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    parts.push(`AND LOWER(p.first_name || ' ' || p.last_name) LIKE $${values.length}`);
  }

  const { rows } = await getPool().query(
    `SELECT
       p.user_id,
       p.first_name,
       p.middle_name,
       p.last_name,
       p.user_type,
       p.company::text AS company,
       p.batch_no,
       p.country,
       p.sending_org,
       (
         SELECT attachment_id FROM v4.shared_attachments
         WHERE relation_type = 'profile' AND relation_id::text = p.user_id::text
         ORDER BY created_at DESC LIMIT 1
       ) AS profile_pic_id
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE a.business_unit = $1
       AND a.is_active = true
       ${parts.join(" ")}
     ORDER BY p.last_name ASC, p.first_name ASC
     LIMIT 100`,
    values,
  );
  return rows;
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
    title, description, category, column_id, deadline, remind_at,
    created_by, team_id, business_unit, col_order,
    parent_task_id, source_message_id, source_channel_id,
  } = data;

  const { rows } = await db(client).query(
    `INSERT INTO v4.tasks
       (title, description, category, column_id, deadline, remind_at,
        created_by, team_id, business_unit, col_order,
        parent_task_id, source_message_id, source_channel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7::uuid, $8, $9, $10, $11, $12, $13)
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
      parent_task_id ?? null,
      source_message_id ?? null,
      source_channel_id ?? null,
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

export const countTasksByColumn = async (columnId, bu) => {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM v4.tasks WHERE column_id = $1::uuid AND business_unit = $2 AND parent_task_id IS NULL`,
    [columnId, bu],
  );
  return rows[0].count;
};

// ─── Delete ────────────────────────────────────────────────────────────────────

export const deleteTask = async (id, bu, client) => {
  const { rowCount } = await db(client).query(
    `DELETE FROM v4.tasks WHERE id = $1::uuid AND business_unit = $2`,
    [id, bu],
  );
  return rowCount;
};
