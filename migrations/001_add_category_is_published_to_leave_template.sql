-- ============================================================
-- Migration: 001_add_category_is_published_to_leave_template
-- Description: Adds `category` and `is_published` columns to
--              v4.leave_template_tbl for multi-form support.
-- Run once against your PostgreSQL database.
-- ============================================================

ALTER TABLE v4.leave_template_tbl
  ADD COLUMN IF NOT EXISTS category TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE;

-- Back-fill existing rows: mark all current templates as published
-- so existing functionality is not broken (optional, adjust as needed).
UPDATE v4.leave_template_tbl
SET is_published = TRUE
WHERE is_published = FALSE;

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_schema = 'v4'
  AND table_name = 'leave_template_tbl'
  AND column_name IN ('category', 'is_published');
