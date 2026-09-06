import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ── Read ───────────────────────────────────────────────────────────────────────

export const findAllByBU = (businessUnit) =>
  getPool().query(
    `SELECT
       s.id, s.first_name, s.last_name, s.display_name,
       s.sending_org, s.country, s.position_title, s.primary_bu,
       s.is_active, s.created_at,
       u.email, u.last_seen,
       COALESCE(
         json_agg(
           json_build_object('business_unit', b.business_unit, 'granted_at', b.granted_at, 'announcements_read', b.announcements_read, 'announcements_write', b.announcements_write)
           ORDER BY b.granted_at
         ) FILTER (WHERE b.business_unit IS NOT NULL AND b.revoked_at IS NULL),
         '[]'
       ) AS bu_access
     FROM v4.souser_tbl s
     JOIN v4.user_account_tbl u ON u.id = s.id
     LEFT JOIN v4.souser_bu_access_tbl b ON b.souser_id = s.id AND b.revoked_at IS NULL
     WHERE s.primary_bu = $1
     GROUP BY s.id, u.email, u.last_seen
     ORDER BY s.last_name, s.first_name`,
    [businessUnit],
  );

export const findById = (id) =>
  getPool().query(
    `SELECT
       s.*, u.email,
       COALESCE(
         json_agg(
           json_build_object('business_unit', b.business_unit, 'granted_at', b.granted_at, 'announcements_read', b.announcements_read, 'announcements_write', b.announcements_write)
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

export const findActiveBuList = (id, client) =>
  db(client).query(
    `SELECT business_unit, announcements_read, announcements_write
     FROM v4.souser_bu_access_tbl
     WHERE souser_id = $1 AND revoked_at IS NULL
     ORDER BY business_unit`,
    [id],
  );

/**
 * Management guard. Every officer-facing souser action resolves the target
 * through this first, so an officer can only reach accounts whose primary BU is
 * their own — matching findAllByBU, which is the list they see. Without it,
 * /souser/:id took a bare id and an officer in one BU could read, edit,
 * deactivate, reset the password of, or delete a souser in another.
 */
export const findByIdInBU = (id, businessUnit, client) =>
  db(client).query(
    `SELECT s.id, s.primary_bu, s.sending_org, s.is_active, u.email, u.is_active AS account_is_active
     FROM v4.souser_tbl s
     JOIN v4.user_account_tbl u ON u.id = s.id
     WHERE s.id = $1::uuid AND s.primary_bu = $2`,
    [id, businessUnit],
  );

// ── Existence checks ───────────────────────────────────────────────────────────

export const countByEmail = (email, client) =>
  db(client).query(
    `SELECT COUNT(*) AS count FROM v4.user_account_tbl WHERE email = $1`,
    [email],
  );

// ── Create ─────────────────────────────────────────────────────────────────────

export const insertUserAccount = (email, businessUnit, client) =>
  db(client).query(
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
}, client) =>
  db(client).query(
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

/**
 * Grant (or re-grant) BU access.
 *
 * DO NOTHING was wrong: revoking sets revoked_at rather than deleting the row,
 * so the row still exists and the conflict fired — re-granting a BU an officer
 * had previously revoked silently did nothing, and the account stayed locked
 * out with the UI showing the grant as applied. DO UPDATE clears the revocation
 * and re-stamps who granted it.
 *
 * announcements_write is carried in explicitly rather than left at whatever the
 * revoked row held, so a re-grant cannot resurrect a stale write permission.
 */
export const insertBuAccess = (souser_id, business_unit, granted_by, announcements_write = false, client) =>
  db(client).query(
    `INSERT INTO v4.souser_bu_access_tbl
       (souser_id, business_unit, granted_by, announcements_write)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (souser_id, business_unit) DO UPDATE
       SET revoked_at          = NULL,
           revoked_by          = NULL,
           granted_at          = NOW(),
           granted_by          = EXCLUDED.granted_by,
           announcements_write = EXCLUDED.announcements_write
     RETURNING business_unit, granted_at, announcements_read, announcements_write`,
    [souser_id, business_unit, granted_by, announcements_write === true],
  );

// ── Update ─────────────────────────────────────────────────────────────────────

export const updateSouserById = (id, { first_name, last_name, display_name, country, position_title }, client) =>
  db(client).query(
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

/**
 * Set the account's active state on BOTH tables.
 *
 * The old toggle only wrote v4.souser_tbl.is_active, which nothing enforces.
 * loginService step 3 and middleware/auth.js both read
 * v4.user_account_tbl.is_active, so a "deactivated" SO user kept logging in and
 * kept a valid Stream token. souser_tbl.is_active stays in step as the column
 * SO User Management displays.
 *
 * Takes an explicit target rather than flipping, so a double-submit is
 * idempotent instead of reactivating the account.
 */
export const setActive = (id, isActive, updatedBy, client) =>
  db(client).query(
    `WITH account AS (
       UPDATE v4.user_account_tbl
       SET is_active = $2, updated_at = NOW()
       WHERE id = $1::uuid
       RETURNING id
     )
     UPDATE v4.souser_tbl s
     SET is_active  = $2,
         updated_at = CURRENT_TIMESTAMP,
         updated_by = $3
     FROM account
     WHERE s.id = account.id
     RETURNING s.id, s.is_active`,
    [id, isActive, updatedBy],
  );

// ── BU Access ──────────────────────────────────────────────────────────────────

export const deleteSouser = async (id, client) => {
  const runner = db(client);
  await runner.query(`DELETE FROM v4.souser_bu_access_tbl WHERE souser_id = $1`, [id]);
  await runner.query(`DELETE FROM v4.souser_tbl WHERE id = $1`, [id]);
  await runner.query(`DELETE FROM v4.user_account_tbl WHERE id = $1`, [id]);
};

export const setPasswordHash = (id, passwordHash, client) =>
  db(client).query(
    `UPDATE v4.user_account_tbl
     SET password_hash = $2, is_active = true
     WHERE id = $1`,
    [id, passwordHash],
  );

export const updatePasswordHash = (id, passwordHash, client) =>
  db(client).query(
    `UPDATE v4.user_account_tbl
     SET password_hash = $2
     WHERE id = $1`,
    [id, passwordHash],
  );

export const revokeBuAccess = (souser_id, business_unit, revoked_by, client) =>
  db(client).query(
    `UPDATE v4.souser_bu_access_tbl
     SET revoked_at = CURRENT_TIMESTAMP,
         revoked_by = $3
     WHERE souser_id = $1 AND business_unit = $2 AND revoked_at IS NULL`,
    [souser_id, business_unit, revoked_by],
  );

export const updateBuAccessPermissions = (souser_id, business_unit, announcements_read, announcements_write, client) =>
  db(client).query(
    `UPDATE v4.souser_bu_access_tbl
     SET announcements_read = $3,
         announcements_write = $4
     WHERE souser_id = $1 AND business_unit = $2 AND revoked_at IS NULL`,
    [souser_id, business_unit, announcements_read === true || announcements_write === true, announcements_write === true],
  );

/**
 * The account-level "Allow bulletin writing" control.
 *
 * Writes the chosen value to every non-revoked BU-access row the account holds,
 * so one switch in SO User Management has one meaning while the enforced check
 * stays per BU (a revoked BU has no row to satisfy it). Newly granted BUs
 * inherit the account's current setting — see souserService.grantBuAccess.
 *
 * Returns the rows it touched so the caller can report the BU scope back.
 */
export const setAnnouncementsWriteForAccount = (souser_id, announcements_write, client) =>
  db(client).query(
    `UPDATE v4.souser_bu_access_tbl
     SET announcements_write = $2
     WHERE souser_id = $1 AND revoked_at IS NULL
     RETURNING business_unit, announcements_write`,
    [souser_id, announcements_write === true],
  );

/** True when the account has the write control on in at least one live BU. */
export const isAnnouncementsWriteEnabled = async (souser_id, client) => {
  const { rows } = await db(client).query(
    `SELECT 1 FROM v4.souser_bu_access_tbl
     WHERE souser_id = $1 AND revoked_at IS NULL AND announcements_write = true
     LIMIT 1`,
    [souser_id],
  );
  return rows.length > 0;
};
