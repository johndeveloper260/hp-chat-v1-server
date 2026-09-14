BEGIN;
CREATE TABLE IF NOT EXISTS v4.app_data_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);
SELECT pg_advisory_xact_lock(hashtext('20260912_bulk_user_create'));

ALTER TABLE v4.user_account_tbl
  ADD COLUMN IF NOT EXISTS email_pending boolean NOT NULL DEFAULT false;

ALTER TABLE v4.bulk_upload_log_row
  ADD COLUMN IF NOT EXISTS action text,
  ADD COLUMN IF NOT EXISTS temp_login_id text,
  ADD COLUMN IF NOT EXISTS temp_password text;

CREATE INDEX IF NOT EXISTS user_account_email_pending_idx
  ON v4.user_account_tbl (email_pending) WHERE email_pending;

INSERT INTO v4.app_data_migrations(version)
VALUES ('20260912_bulk_user_create') ON CONFLICT DO NOTHING;
COMMIT;
