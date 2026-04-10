/**
 * Task Team Repository
 *
 * Raw SQL for v4.task_teams and v4.task_team_members.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── Teams ─────────────────────────────────────────────────────────────────────

export const findTeamsByBU = async (bu) => {
  const { rows } = await getPool().query(
    `SELECT
       t.id,
       t.name,
       t.description,
       t.business_unit,
       t.created_by,
       t.created_at,
       t.updated_at,
       COUNT(tm.user_id)::int AS member_count,
       COALESCE(
         json_agg(
           json_build_object(
             'user_id', p.user_id,
             'first_name', p.first_name,
             'middle_name', p.middle_name,
             'last_name', p.last_name,
             'profile_pic_id', sa.attachment_id
           ) ORDER BY p.first_name ASC
         ) FILTER (WHERE p.user_id IS NOT NULL),
         '[]'::json
       ) AS members
     FROM v4.task_teams t
     LEFT JOIN v4.task_team_members tm ON t.id = tm.team_id
     LEFT JOIN v4.user_profile_tbl p ON tm.user_id = p.user_id
     LEFT JOIN LATERAL (
       SELECT attachment_id
       FROM v4.shared_attachments
       WHERE relation_type = 'profile' AND relation_id = tm.user_id::text
       ORDER BY created_at DESC
       LIMIT 1
     ) sa ON true
     WHERE t.business_unit = $1
     GROUP BY t.id
     ORDER BY t.created_at DESC`,
    [bu],
  );
  return rows;
};

export const findTeamById = async (id, bu) => {
  const { rows } = await getPool().query(
    `SELECT
       t.id,
       t.name,
       t.description,
       t.business_unit,
       t.created_by,
       t.created_at,
       t.updated_at,
       COUNT(tm.user_id)::int AS member_count,
       COALESCE(
         json_agg(
           json_build_object(
             'user_id', p.user_id,
             'first_name', p.first_name,
             'middle_name', p.middle_name,
             'last_name', p.last_name,
             'profile_pic_id', sa.attachment_id
           ) ORDER BY p.first_name ASC
         ) FILTER (WHERE p.user_id IS NOT NULL),
         '[]'::json
       ) AS members
     FROM v4.task_teams t
     LEFT JOIN v4.task_team_members tm ON t.id = tm.team_id
     LEFT JOIN v4.user_profile_tbl p ON tm.user_id = p.user_id
     LEFT JOIN LATERAL (
       SELECT attachment_id
       FROM v4.shared_attachments
       WHERE relation_type = 'profile' AND relation_id = tm.user_id::text
       ORDER BY created_at DESC
       LIMIT 1
     ) sa ON true
     WHERE t.id = $1::uuid AND t.business_unit = $2
     GROUP BY t.id`,
    [id, bu],
  );
  return rows[0] ?? null;
};

export const insertTeam = async ({ name, description, business_unit, created_by }) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.task_teams (name, description, business_unit, created_by)
     VALUES ($1, $2, $3, $4::uuid)
     RETURNING id, name, description, business_unit, created_by, created_at, updated_at`,
    [name, description ?? null, business_unit, created_by],
  );
  return rows[0];
};

export const updateTeam = async (id, { name, description }, bu) => {
  const sets = [];
  const values = [];

  if (name !== undefined)        { values.push(name);        sets.push(`name = $${values.length}`); }
  if (description !== undefined) { values.push(description); sets.push(`description = $${values.length}`); }

  if (sets.length === 0) return null;

  sets.push(`updated_at = NOW()`);
  values.push(id);
  values.push(bu);

  const { rows } = await getPool().query(
    `UPDATE v4.task_teams
     SET ${sets.join(", ")}
     WHERE id = $${values.length - 1}::uuid AND business_unit = $${values.length}
     RETURNING id, name, description, business_unit, created_by, created_at, updated_at`,
    values,
  );
  return rows[0] ?? null;
};

export const deleteTeam = async (id, bu) => {
  const { rowCount } = await getPool().query(
    `DELETE FROM v4.task_teams WHERE id = $1::uuid AND business_unit = $2`,
    [id, bu],
  );
  return rowCount;
};

// ─── Members ───────────────────────────────────────────────────────────────────

export const findTeamMembers = async (teamId) => {
  const { rows } = await getPool().query(
    `SELECT
       tm.user_id,
       tm.joined_at,
       p.first_name,
       p.middle_name,
       p.last_name,
       sa.attachment_id AS profile_pic_id
     FROM v4.task_team_members tm
     JOIN v4.user_profile_tbl p ON tm.user_id = p.user_id
     LEFT JOIN LATERAL (
       SELECT attachment_id
       FROM v4.shared_attachments
       WHERE relation_type = 'profile' AND relation_id = tm.user_id::text
       ORDER BY created_at DESC
       LIMIT 1
     ) sa ON true
     WHERE tm.team_id = $1::uuid
     ORDER BY p.first_name ASC`,
    [teamId],
  );
  return rows;
};

export const addMember = async (teamId, userId) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.task_team_members (team_id, user_id)
     VALUES ($1::uuid, $2::uuid)
     ON CONFLICT (team_id, user_id) DO NOTHING
     RETURNING team_id, user_id, joined_at`,
    [teamId, userId],
  );
  return rows[0] ?? null;
};

export const removeMember = async (teamId, userId) => {
  const { rowCount } = await getPool().query(
    `DELETE FROM v4.task_team_members
     WHERE team_id = $1::uuid AND user_id = $2::uuid`,
    [teamId, userId],
  );
  return rowCount;
};

export const isTeamMember = async (teamId, userId) => {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM v4.task_team_members
     WHERE team_id = $1::uuid AND user_id = $2::uuid`,
    [teamId, userId],
  );
  return rowCount > 0;
};
