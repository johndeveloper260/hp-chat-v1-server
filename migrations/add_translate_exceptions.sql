ALTER TABLE v4.user_account_tbl
  ADD COLUMN IF NOT EXISTS translate_exceptions TEXT[] NOT NULL DEFAULT '{}';
