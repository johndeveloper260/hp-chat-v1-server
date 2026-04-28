-- Prevents duplicate in-progress attempts for the same user + assessment.
-- ON CONFLICT in createAttempt uses this index for idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_attempt_inprogress
  ON v4.assessment_attempt_tbl (assessment_id, user_id)
  WHERE status = 'in_progress';
