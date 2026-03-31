-- Add notification preference to user accounts
-- Default TRUE so all existing users continue to receive notifications
ALTER TABLE v4.user_account_tbl
  ADD COLUMN IF NOT EXISTS notification BOOLEAN NOT NULL DEFAULT TRUE;
