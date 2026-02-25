-- Migration: 002_add_last_seen_to_user_account
-- Tracks the last time a user made any authenticated request.
-- Unlike last_login, this updates on every API call (throttled to 5 min intervals).
-- Useful for "active user" reporting without requiring explicit logout/login cycles.

ALTER TABLE v4.user_account_tbl
  ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NULL;

-- Index for activity-based queries (e.g., "users active in last 30 days")
CREATE INDEX IF NOT EXISTS idx_user_account_last_seen
  ON v4.user_account_tbl (last_seen DESC);

COMMENT ON COLUMN v4.user_account_tbl.last_seen IS 'Updated on every authenticated API request (throttled to 5-minute intervals). Tracks real app usage independent of login/logout.';
