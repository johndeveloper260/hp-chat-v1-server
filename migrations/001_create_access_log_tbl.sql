-- Migration: 001_create_access_log_tbl
-- Tracks full login history per user for audit and security purposes.

CREATE TABLE IF NOT EXISTS v4.access_log_tbl (
  log_id        BIGSERIAL PRIMARY KEY,
  user_id       UUID          NOT NULL REFERENCES v4.user_account_tbl(id) ON DELETE CASCADE,
  business_unit VARCHAR(20)   NOT NULL,
  ip_address    VARCHAR(45),        -- supports IPv4 and IPv6
  user_agent    TEXT,
  logged_in_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Index for fast per-user history lookups
CREATE INDEX IF NOT EXISTS idx_access_log_user_id
  ON v4.access_log_tbl (user_id, logged_in_at DESC);

-- Index for business_unit-level reporting
CREATE INDEX IF NOT EXISTS idx_access_log_business_unit
  ON v4.access_log_tbl (business_unit, logged_in_at DESC);

COMMENT ON TABLE v4.access_log_tbl IS 'Stores login history for every user. Used for audit trails, security monitoring, and admin activity reports.';
