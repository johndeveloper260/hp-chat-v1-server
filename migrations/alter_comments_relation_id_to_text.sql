-- Add sequential row_id to v4.tasks so tasks can be referenced
-- by shared_comments.relation_id (integer column) without altering that column.
-- Existing rows are backfilled automatically by the SERIAL default.
ALTER TABLE v4.tasks ADD COLUMN IF NOT EXISTS row_id SERIAL;
