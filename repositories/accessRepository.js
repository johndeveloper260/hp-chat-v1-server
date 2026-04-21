/**
 * Access Repository
 *
 * All SQL for role assignment / revocation lives here.
 * Accepts an optional `client` so callers can participate in a transaction.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Officer user listing ──────────────────────────────────────────────────────

export const findOfficerUsers = (search = "", businessUnit) =>
  getPool().query(
    `SELECT p.user_id::text AS id,
            p.first_name, p.last_name, p.user_type, a.business_unit,
            a.email, a.is_active
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE a.business_unit = $2
       AND UPPER(p.user_type) = 'OFFICER'
       AND NOT EXISTS (
         SELECT 1 FROM v4.deleted_users_log d
         WHERE d.original_user_id = p.user_id
       )
       AND ($1 = ''
            OR LOWER(p.first_name || ' ' || p.last_name) LIKE '%' || LOWER($1) || '%'
            OR LOWER(a.email) LIKE '%' || LOWER($1) || '%')
     ORDER BY p.last_name, p.first_name
     LIMIT 50`,
    [search, businessUnit],
  );

// ── Role definitions ──────────────────────────────────────────────────────────

export const findAllRoleDefinitions = () =>
  getPool().query(
    `SELECT role_name, module, access_level, description
     FROM v4.role_definitions
     ORDER BY module, access_level`,
  );

// ── User role assignments ─────────────────────────────────────────────────────

export const findUserRolesList = (userId) =>
  getPool().query(
    `SELECT ur.role_name, rd.module, rd.access_level, ur.created_at,
            grantor.first_name || ' ' || grantor.last_name AS granted_by_name
     FROM v4.user_roles ur
     JOIN v4.role_definitions rd USING (role_name)
     LEFT JOIN v4.user_profile_tbl grantor ON grantor.user_id = ur.granted_by
     WHERE ur.user_id = $1::uuid
     ORDER BY rd.module, rd.access_level`,
    [userId],
  );

// ── Guard helpers ─────────────────────────────────────────────────────────────

export const findUserTypeById = (userId, client) =>
  db(client).query(
    `SELECT p.user_type, a.business_unit
     FROM v4.user_profile_tbl p
     JOIN v4.user_account_tbl a ON a.id = p.user_id
     WHERE p.user_id = $1::uuid`,
    [userId],
  );

// ── Mutations ─────────────────────────────────────────────────────────────────

export const insertUserRole = (userId, roleName, grantedBy, client) =>
  db(client).query(
    `INSERT INTO v4.user_roles (user_id, role_name, granted_by)
     VALUES ($1::uuid, $2, $3::uuid)
     ON CONFLICT (user_id, role_name) DO NOTHING`,
    [userId, roleName, grantedBy],
  );

export const deleteUserRole = (userId, roleName, client) =>
  db(client).query(
    `DELETE FROM v4.user_roles WHERE user_id = $1::uuid AND role_name = $2`,
    [userId, roleName],
  );

export const deleteAllUserRoles = (userId, client) =>
  db(client).query(
    `DELETE FROM v4.user_roles WHERE user_id = $1::uuid`,
    [userId],
  );
