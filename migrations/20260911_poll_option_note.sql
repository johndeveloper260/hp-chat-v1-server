-- ============================================================================
-- 20260911_poll_option_note.sql
--
-- Poll options can require a free-text explanation from the respondent
-- ("Other — please specify"). The flag lives on the option; the text lives on
-- the response row, which is already one row per user × option.
--
-- migrations/ has no runner. Apply by hand, after 20260911_announcement_poll,
-- inside a transaction. Idempotent.
-- ============================================================================

BEGIN;
CREATE TABLE IF NOT EXISTS v4.app_data_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT NOW()
);
SELECT pg_advisory_xact_lock(hashtext('20260911_poll_option_note'));

ALTER TABLE v4.announcement_poll_option_tbl
  ADD COLUMN IF NOT EXISTS requires_note boolean NOT NULL DEFAULT false;

ALTER TABLE v4.announcement_poll_response_tbl
  ADD COLUMN IF NOT EXISTS note text;

COMMENT ON COLUMN v4.announcement_poll_option_tbl.requires_note IS
  'When true a response choosing this option must carry a non-empty note. Part of the poll definition: frozen once responses exist.';
COMMENT ON COLUMN v4.announcement_poll_response_tbl.note IS
  'Respondent''s explanation for this option. Required when the option has requires_note; optional otherwise. Visible only through the coordinator results/export.';

INSERT INTO v4.app_data_migrations(version) VALUES ('20260911_poll_option_note') ON CONFLICT DO NOTHING;
COMMIT;

-- ROLLBACK
-- BEGIN;
-- DELETE FROM v4.app_data_migrations WHERE version = '20260911_poll_option_note';
-- ALTER TABLE v4.announcement_poll_response_tbl DROP COLUMN IF EXISTS note;
-- ALTER TABLE v4.announcement_poll_option_tbl DROP COLUMN IF EXISTS requires_note;
-- COMMIT;
