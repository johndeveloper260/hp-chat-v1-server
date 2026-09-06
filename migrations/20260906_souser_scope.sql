-- ============================================================================
-- 20260906_souser_scope.sql
--
-- SOUSER scoping: sending-organisation-scoped bulletins, an explicit
-- "Allow bulletin writing" control, and deactivation alignment.
--
-- migrations/ has no runner. Apply by hand, in order, inside a transaction.
-- Every step is idempotent so a partial run can be re-applied safely.
--
-- READ FIRST: step 3 can lock accounts out of the product. Run the
-- verification SELECT above it and review the row count before committing.
-- ============================================================================

BEGIN;
CREATE TABLE IF NOT EXISTS v4.app_data_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);
-- Serialize concurrent executions before checking the completion marker.
SELECT pg_advisory_xact_lock(hashtext('20260906_souser_scope'));

-- ---------------------------------------------------------------------------
-- 1. Announcement authorship scope
--
-- A bulletin written by a SOUSER is visible only to that sending organisation.
-- a.sending_org cannot carry that meaning: an officer also sets it to target an
-- organisation's employees, and those posts stay officer-owned and generally
-- readable. A separate column records "this row was authored by a SOUSER of
-- organisation X" and is what every visibility check keys on.
--
-- NULL  => officer/admin-authored, general-feed rules apply.
-- non-NULL => SOUSER-authored, restricted to that sending_org.
-- ---------------------------------------------------------------------------

ALTER TABLE v4.announcement_tbl
  ADD COLUMN IF NOT EXISTS created_by_sending_org text;

COMMENT ON COLUMN v4.announcement_tbl.created_by_sending_org IS
  'Sending-org code of the SOUSER author. NULL for officer/admin-authored posts. '
  'Set by the server from the authenticated account; never from the request body.';

-- Backfill: every announcement already authored by a SOUSER becomes
-- organisation-restricted. Before this migration those posts were visible to
-- any account in the BU whose country and sending_org happened to match, so
-- this narrows their audience — which is the point of the change.
UPDATE v4.announcement_tbl a
SET    created_by_sending_org = s.sending_org
FROM   v4.souser_tbl s
WHERE  s.id = a.created_by::uuid
  AND  a.created_by_sending_org IS NULL
  AND  s.sending_org IS NOT NULL;

CREATE INDEX IF NOT EXISTS announcement_tbl_bu_author_org_idx
  ON v4.announcement_tbl (business_unit, created_by_sending_org);

-- ---------------------------------------------------------------------------
-- 2. "Allow bulletin writing" control
--
-- Reuses the existing v4.souser_bu_access_tbl.announcements_write column rather
-- than adding a parallel flag. The control is presented per ACCOUNT in SO User
-- Management; the server writes the chosen value to every non-revoked BU-access
-- row for that account, and newly granted BUs inherit it. Effective permission
-- is therefore still evaluated per BU: writing in BU X requires a non-revoked
-- row for X with announcements_write = true.
--
-- Existing grants are handled explicitly: the flag predates the scoping rules in
-- this migration and was set while a SOUSER's post could reach a far wider
-- audience than it can now. Rather than carry those grants forward silently,
-- they are snapshotted and reset to false, so an officer re-grants deliberately
-- under the new rules. The snapshot table is the rollback source.
-- ---------------------------------------------------------------------------

ALTER TABLE v4.souser_bu_access_tbl
  ALTER COLUMN announcements_write SET DEFAULT false;

CREATE TABLE IF NOT EXISTS v4.souser_bu_access_write_backup_20260906 (
  souser_id           uuid        NOT NULL,
  business_unit       text        NOT NULL,
  announcements_write boolean     NOT NULL,
  announcements_read  boolean,
  captured_at         timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY (souser_id, business_unit)
);

DO $migration$ BEGIN
IF NOT EXISTS (SELECT 1 FROM v4.app_data_migrations WHERE version = '20260906_souser_scope') THEN
INSERT INTO v4.souser_bu_access_write_backup_20260906
       (souser_id, business_unit, announcements_write, announcements_read)
SELECT souser_id, business_unit, announcements_write, announcements_read
FROM   v4.souser_bu_access_tbl
WHERE  announcements_write IS TRUE
ON CONFLICT (souser_id, business_unit) DO NOTHING;

UPDATE v4.souser_bu_access_tbl
SET    announcements_write = false
WHERE  announcements_write IS TRUE;

-- Backstop for rows written before the DEFAULT existed.
UPDATE v4.souser_bu_access_tbl
SET    announcements_write = false
WHERE  announcements_write IS NULL;

END IF;
END $migration$;

-- ---------------------------------------------------------------------------
-- 3. Deactivation alignment  ** REVIEW BEFORE COMMITTING **
--
-- SO User Management's activation toggle wrote v4.souser_tbl.is_active, but
-- login (services/loginService.js) and middleware/auth.js both read
-- v4.user_account_tbl.is_active. Every SOUSER an officer believed they had
-- deactivated has kept full API and Stream access.
--
-- This propagates those decisions to the column that is actually enforced.
-- It is deliberately narrow: only rows where the toggle demonstrably ran
-- (updated_by IS NOT NULL) are propagated, so a souser_tbl.is_active default
-- of false on never-touched rows cannot mass-deactivate live accounts.
--
-- Run this first and read the count. These accounts lose access on commit:
--
--   SELECT s.id, u.email, s.primary_bu, s.sending_org, s.updated_at
--   FROM   v4.souser_tbl s
--   JOIN   v4.user_account_tbl u ON u.id = s.id
--   WHERE  s.is_active = false
--     AND  s.updated_by IS NOT NULL
--     AND  u.is_active = true;
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS v4.souser_activation_backup_20260906 (
  souser_id            uuid        NOT NULL PRIMARY KEY,
  account_is_active    boolean     NOT NULL,
  souser_is_active     boolean     NOT NULL,
  captured_at          timestamptz NOT NULL DEFAULT NOW()
);

DO $migration$ BEGIN
IF NOT EXISTS (SELECT 1 FROM v4.app_data_migrations WHERE version = '20260906_souser_scope') THEN
INSERT INTO v4.souser_activation_backup_20260906
       (souser_id, account_is_active, souser_is_active)
SELECT s.id, u.is_active, s.is_active
FROM   v4.souser_tbl s
JOIN   v4.user_account_tbl u ON u.id = s.id
ON CONFLICT (souser_id) DO NOTHING;

UPDATE v4.user_account_tbl u
SET    is_active  = false,
       updated_at = NOW()
FROM   v4.souser_tbl s
WHERE  s.id = u.id
  AND  s.is_active = false
  AND  s.updated_by IS NOT NULL
  AND  u.is_active = true;

-- Converse direction: an account reactivated through the toggle should not stay
-- locked out. Same evidence requirement.
UPDATE v4.user_account_tbl u
SET    is_active  = true,
       updated_at = NOW()
FROM   v4.souser_tbl s
WHERE  s.id = u.id
  AND  s.is_active = true
  AND  s.updated_by IS NOT NULL
  AND  u.is_active = false
  AND  u.password_hash IS NOT NULL
  AND  u.password_hash <> '';

INSERT INTO v4.app_data_migrations(version) VALUES ('20260906_souser_scope');
END IF;
END $migration$;

COMMIT;

-- ============================================================================
-- ROLLBACK
--
-- BEGIN;
--
-- -- 3. restore activation
-- UPDATE v4.user_account_tbl u
-- SET    is_active = b.account_is_active
-- FROM   v4.souser_activation_backup_20260906 b
-- WHERE  b.souser_id = u.id;
--
-- -- 2. restore write grants
-- UPDATE v4.souser_bu_access_tbl a
-- SET    announcements_write = b.announcements_write
-- FROM   v4.souser_bu_access_write_backup_20260906 b
-- WHERE  b.souser_id = a.souser_id
--   AND  b.business_unit = a.business_unit;
--
-- DELETE FROM v4.app_data_migrations WHERE version = '20260906_souser_scope';
-- -- 1. drop authorship scope (reverts every SOUSER post to the old wide audience)
-- DROP INDEX IF EXISTS v4.announcement_tbl_bu_author_org_idx;
-- ALTER TABLE v4.announcement_tbl DROP COLUMN IF EXISTS created_by_sending_org;
--
-- COMMIT;
--
-- The backup tables are kept, not dropped — they are the only record of the
-- pre-migration state. Drop them once the rollout is confirmed.
-- ============================================================================
