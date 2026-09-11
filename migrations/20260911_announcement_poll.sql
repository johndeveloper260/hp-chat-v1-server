BEGIN;
CREATE TABLE IF NOT EXISTS v4.app_data_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);
SELECT pg_advisory_xact_lock(hashtext('20260911_announcement_poll'));

CREATE TABLE IF NOT EXISTS v4.announcement_poll_tbl (
  poll_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  announcement_id integer NOT NULL UNIQUE REFERENCES v4.announcement_tbl(row_id) ON DELETE CASCADE,
  business_unit text NOT NULL,
  question text NOT NULL,
  allow_multiple boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  is_locked boolean NOT NULL DEFAULT false,
  locked_at timestamptz,
  locked_by uuid,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  updated_at timestamptz
);
CREATE TABLE IF NOT EXISTS v4.announcement_poll_option_tbl (
  option_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id uuid NOT NULL REFERENCES v4.announcement_poll_tbl(poll_id) ON DELETE CASCADE,
  label text NOT NULL,
  sort_order integer NOT NULL,
  UNIQUE (poll_id, sort_order)
);
CREATE TABLE IF NOT EXISTS v4.announcement_poll_response_tbl (
  poll_id uuid NOT NULL REFERENCES v4.announcement_poll_tbl(poll_id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  option_id uuid NOT NULL REFERENCES v4.announcement_poll_option_tbl(option_id) ON DELETE CASCADE,
  business_unit text NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, user_id, option_id)
);
CREATE INDEX IF NOT EXISTS announcement_poll_response_poll_idx ON v4.announcement_poll_response_tbl (poll_id, option_id);
CREATE INDEX IF NOT EXISTS announcement_poll_response_user_idx ON v4.announcement_poll_response_tbl (poll_id, user_id);
COMMENT ON COLUMN v4.announcement_poll_tbl.business_unit IS 'Denormalised business unit for BU-bounded poll queries and deletes.';
COMMENT ON COLUMN v4.announcement_poll_response_tbl.business_unit IS 'Denormalised business unit for BU-bounded response queries and deletes.';
COMMENT ON COLUMN v4.announcement_poll_tbl.is_locked IS 'Manual response lock; closes_at is the independent scheduled close.';
COMMENT ON COLUMN v4.announcement_poll_tbl.closes_at IS 'Scheduled close time; is_locked is the independent manual lock.';
INSERT INTO v4.app_data_migrations(version) VALUES ('20260911_announcement_poll') ON CONFLICT DO NOTHING;
COMMIT;

-- ROLLBACK
-- BEGIN;
-- DELETE FROM v4.app_data_migrations WHERE version = '20260911_announcement_poll';
-- DROP TABLE IF EXISTS v4.announcement_poll_response_tbl;
-- DROP TABLE IF EXISTS v4.announcement_poll_option_tbl;
-- DROP TABLE IF EXISTS v4.announcement_poll_tbl;
-- COMMIT;
