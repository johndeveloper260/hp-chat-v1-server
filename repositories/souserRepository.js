import { getPool } from "../config/getPool.js";

// ── Read ───────────────────────────────────────────────────────────────────────

export const findAllByBU = (businessUnit) =>
  getPool().query(
    `SELECT
       s.id, s.first_name, s.last_name, s.display_name,
       s.sending_org, s.country, s.position_title, s.primary_bu,
       s.is_active, s.created_at,
       u.email,
       COALESCE(
         json_agg(
           json_build_object('business_unit', b.business_unit, 'granted_at', b.granted_at)
           ORDER BY b.granted_at
         ) FILTER (WHERE b.business_unit IS NOT NULL AND b.revoked_at IS NULL),
         '[]'
       ) AS bu_access
     FROM v4.souser_tbl s
     JOIN v4.user_account_tbl u ON u.id = s.id
     LEFT JOIN v4.souser_bu_access_tbl b ON b.souser_id = s.id AND b.revoked_at IS NULL
     WHERE s.primary_bu = $1
     GROUP BY s.id, u.email
     ORDER BY s.last_name, s.first_name`,
    [businessUnit],
  );

export const findById = (id) =>
  getPool().query(
    `SELECT
       s.*, u.email,
       COALESCE(
         json_agg(
           json_build_object('business_unit', b.business_unit, 'granted_at', b.granted_at)
           ORDER BY b.granted_at
         ) FILTER (WHERE b.business_unit IS NOT NULL AND b.revoked_at IS NULL),
         '[]'
       ) AS bu_access
     FROM v4.souser_tbl s
     JOIN v4.user_account_tbl u ON u.id = s.id
     LEFT JOIN v4.souser_bu_access_tbl b ON b.souser_id = s.id AND b.revoked_at IS NULL
     WHERE s.id = $1
     GROUP BY s.id, u.email`,
    [id],
  );

export const findActiveBuList = (id) =>
  getPool().query(
    `SELECT business_unit FROM v4.souser_bu_access_tbl
     WHERE souser_id = $1 AND revoked_at IS NULL`,
    [id],
  );

// ── Existence checks ───────────────────────────────────────────────────────────

export const countByEmail = (email) =>
  getPool().query(
    `SELECT COUNT(*) AS count FROM v4.user_account_tbl WHERE email = $1`,
    [email],
  );

// ── Create ─────────────────────────────────────────────────────────────────────

export const insertUserAccount = (email, businessUnit) =>
  getPool().query(
    `INSERT INTO v4.user_account_tbl (email, business_unit, is_active)
     VALUES ($1, $2, false)
     RETURNING id`,
    [email, businessUnit],
  );

export const insertSouser = ({
  id,
  sending_org,
  first_name,
  last_name,
  display_name,
  country,
  position_title,
  primary_bu,
  created_by_officer,
}) =>
  getPool().query(
    `INSERT INTO v4.souser_tbl
       (id, sending_org, first_name, last_name, display_name, country, position_title, primary_bu, created_by_officer)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      id,
      sending_org,
      first_name,
      last_name,
      display_name ?? null,
      country,
      position_title ?? null,
      primary_bu,
      created_by_officer,
    ],
  );

export const insertBuAccess = (souser_id, business_unit, granted_by) =>
  getPool().query(
    `INSERT INTO v4.souser_bu_access_tbl (souser_id, business_unit, granted_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (souser_id, business_unit) DO NOTHING`,
    [souser_id, business_unit, granted_by],
  );

// ── Update ─────────────────────────────────────────────────────────────────────

export const updateSouserById = (id, { first_name, last_name, display_name, country, position_title }) =>
  getPool().query(
    `UPDATE v4.souser_tbl
     SET first_name      = COALESCE($1, first_name),
         last_name       = COALESCE($2, last_name),
         display_name    = $3,
         country         = COALESCE($4, country),
         position_title  = $5,
         updated_at      = CURRENT_TIMESTAMP
     WHERE id = $6
     RETURNING *`,
    [first_name ?? null, last_name ?? null, display_name ?? null, country ?? null, position_title ?? null, id],
  );

export const toggleActive = (id, updatedBy) =>
  getPool().query(
    `UPDATE v4.souser_tbl
     SET is_active  = NOT is_active,
         updated_at = CURRENT_TIMESTAMP,
         updated_by = $2
     WHERE id = $1
     RETURNING id, is_active`,
    [id, updatedBy],
  );

// ── BU Access ──────────────────────────────────────────────────────────────────

export const deleteSouser = async (id) => {
  const pool = getPool();
  await pool.query(`DELETE FROM v4.souser_bu_access_tbl WHERE souser_id = $1`, [id]);
  await pool.query(`DELETE FROM v4.souser_tbl WHERE id = $1`, [id]);
  await pool.query(`DELETE FROM v4.user_account_tbl WHERE id = $1`, [id]);
};

export const setPasswordHash = (id, passwordHash) =>
  getPool().query(
    `UPDATE v4.user_account_tbl
     SET password_hash = $2, is_active = true
     WHERE id = $1`,
    [id, passwordHash],
  );

export const revokeBuAccess = (souser_id, business_unit, revoked_by) =>
  getPool().query(
    `UPDATE v4.souser_bu_access_tbl
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by = $3
     WHERE souser_id = $1 AND business_unit = $2 AND revoked_at IS NULL`,
    [souser_id, business_unit, revoked_by],
  );
