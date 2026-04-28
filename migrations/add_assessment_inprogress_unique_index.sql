-- Step 1: Deduplicate existing in-progress attempts.
-- For each (assessment_id, user_id) pair that has more than one in-progress row,
-- keep the most recently started one and mark the rest as timed_out.
UPDATE v4.assessment_attempt_tbl
SET status = 'timed_out', updated_at = NOW()
WHERE status = 'in_progress'
  AND attempt_id NOT IN (
    SELECT DISTINCT ON (assessment_id, user_id) attempt_id
    FROM v4.assessment_attempt_tbl
    WHERE status = 'in_progress'
    ORDER BY assessment_id, user_id, started_at DESC
  );

-- Step 2: Now that duplicates are gone, create the partial unique index.
-- ON CONFLICT in createAttempt uses this index for idempotent upsert.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assessment_attempt_inprogress
  ON v4.assessment_attempt_tbl (assessment_id, user_id)
  WHERE status = 'in_progress';
