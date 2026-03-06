import { getPool } from "../config/getPool.js";

/**
 * Shared guard: confirms the target user exists and is user_type = OFFICER.
 * Accepts either a pool or a transaction client so it works in both contexts.
 *
 * Throws a plain object { status, message } on failure — callers must catch
 * and turn it into an HTTP response.
 */
const assertTargetIsOfficer = async (db, userId) => {
  const { rows } = await db.query(
    `SELECT user_type FROM v4.user_profile_tbl WHERE user_id = $1::uuid`,
    [userId],
  );
  if (rows.length === 0) {
    throw { status: 404, message: "Target user not found." };
  }
  if ((rows[0].user_type || "").toUpperCase() !== "OFFICER") {
    throw { status: 422, message: "Roles can only be assigned to OFFICER users." };
  }
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /access/users?search=
 * Returns a list of active OFFICER users for the Role Management UI.
 * Filtered to user_type = OFFICER only — roles have no effect on other types.
 * Requires role_management_write.
 */
export const getUsers = async (req, res) => {
  const { search = "" } = req.query;
  try {
    const { rows } = await getPool().query(
      `SELECT p.user_id::text AS id,
              p.first_name, p.last_name, p.user_type, p.business_unit,
              a.email
       FROM v4.user_profile_tbl p
       JOIN v4.user_account_tbl a ON a.id = p.user_id
       WHERE a.is_active = true
         AND UPPER(p.user_type) = 'OFFICER'
         AND ($1 = ''
              OR LOWER(p.first_name || ' ' || p.last_name) LIKE '%' || LOWER($1) || '%'
              OR LOWER(a.email) LIKE '%' || LOWER($1) || '%')
       ORDER BY p.last_name, p.first_name
       LIMIT 50`,
      [search],
    );
    res.json({ users: rows });
  } catch (err) {
    console.error("getUsers error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /access/roles/definitions
 * Returns all available role definitions.
 * Used by the UI to render the permission management grid.
 */
export const getAllRoleDefinitions = async (req, res) => {
  try {
    const { rows } = await getPool().query(
      `SELECT role_name, module, access_level, description
       FROM v4.role_definitions
       ORDER BY module, access_level`,
    );
    res.json({ roles: rows });
  } catch (err) {
    console.error("getAllRoleDefinitions error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * GET /access/roles/:userId
 * Returns the module roles currently assigned to a specific user.
 */
export const getUserRoles = async (req, res) => {
  const { userId } = req.params;
  try {
    const { rows } = await getPool().query(
      `SELECT ur.role_name, rd.module, rd.access_level, ur.created_at,
              grantor.first_name || ' ' || grantor.last_name AS granted_by_name
       FROM v4.user_roles ur
       JOIN v4.role_definitions rd USING (role_name)
       LEFT JOIN v4.user_profile_tbl grantor ON grantor.user_id = ur.granted_by
       WHERE ur.user_id = $1::uuid
       ORDER BY rd.module, rd.access_level`,
      [userId],
    );
    res.json({ roles: rows });
  } catch (err) {
    console.error("getUserRoles error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * POST /access/roles/:userId
 * Assigns a single role to a user.
 * Body: { role_name: "announcements_write" }
 * Target user must be user_type = OFFICER.
 */
export const assignRole = async (req, res) => {
  const { userId } = req.params;
  const { role_name } = req.body;

  if (!role_name) {
    return res.status(400).json({ error: "role_name is required" });
  }

  try {
    await assertTargetIsOfficer(getPool(), userId);

    await getPool().query(
      `INSERT INTO v4.user_roles (user_id, role_name, granted_by)
       VALUES ($1::uuid, $2, $3::uuid)
       ON CONFLICT (user_id, role_name) DO NOTHING`,
      [userId, role_name, req.user.id],
    );
    res.json({ success: true, message: `Role '${role_name}' assigned.` });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("assignRole error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * DELETE /access/roles/:userId/:roleName
 * Revokes a single role from a user.
 * Target user must be user_type = OFFICER.
 */
export const revokeRole = async (req, res) => {
  const { userId, roleName } = req.params;
  try {
    await assertTargetIsOfficer(getPool(), userId);

    await getPool().query(
      `DELETE FROM v4.user_roles WHERE user_id = $1::uuid AND role_name = $2`,
      [userId, roleName],
    );
    res.json({ success: true, message: `Role '${roleName}' revoked.` });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error("revokeRole error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * PUT /access/roles/:userId
 * Atomic full replacement — removes all current roles and sets the new list.
 * Body: { roles: ["announcements_write", "leave_read"] }
 * Target user must be user_type = OFFICER.
 */
export const replaceUserRoles = async (req, res) => {
  const { userId } = req.params;
  const { roles } = req.body;

  if (!Array.isArray(roles)) {
    return res.status(400).json({ error: "roles must be an array" });
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Validate target user is OFFICER — inside the transaction for consistency
    await assertTargetIsOfficer(client, userId);

    // Remove all existing roles for this user
    await client.query(
      `DELETE FROM v4.user_roles WHERE user_id = $1::uuid`,
      [userId],
    );
    // Insert the new set
    for (const role_name of roles) {
      await client.query(
        `INSERT INTO v4.user_roles (user_id, role_name, granted_by)
         VALUES ($1::uuid, $2, $3::uuid)`,
        [userId, role_name, req.user.id],
      );
    }
    await client.query("COMMIT");
    res.json({ success: true, message: "Roles updated successfully." });
  } catch (err) {
    await client.query("ROLLBACK");
    // Custom { status, message } thrown by assertTargetIsOfficer
    if (err.status) return res.status(err.status).json({ error: err.message });
    // FK violation: role_name not present in v4.role_definitions
    if (err.code === "23503" && err.constraint === "user_roles_role_name_fkey") {
      return res.status(400).json({
        error: `Unknown role name: '${err.detail?.match(/\(role_name\)=\((.+?)\)/)?.[1] ?? "unknown"}'. Add it to v4.role_definitions first.`,
      });
    }
    console.error("replaceUserRoles error:", err);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
};
