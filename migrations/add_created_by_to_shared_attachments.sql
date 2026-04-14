-- Add created_by column to track the uploader of each attachment.
-- Required for per-user attachment isolation on subtasks.
ALTER TABLE v4.shared_attachments
  ADD COLUMN IF NOT EXISTS created_by UUID;
