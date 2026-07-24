BEGIN;

ALTER TABLE v4.return_home_tbl
  ADD COLUMN IF NOT EXISTS cancelled_by UUID,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'v4.return_home_tbl'::regclass
      AND conname = 'fk_return_home_cancelled_by'
  ) THEN
    ALTER TABLE v4.return_home_tbl
      ADD CONSTRAINT fk_return_home_cancelled_by
      FOREIGN KEY (cancelled_by) REFERENCES v4.user_account_tbl(id);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'v4.return_home_tbl'::regclass
      AND conname = 'check_return_home_cancellation_metadata'
  ) THEN
    ALTER TABLE v4.return_home_tbl
      ADD CONSTRAINT check_return_home_cancellation_metadata
      CHECK (
        status <> 'Cancelled'
        OR (
          cancelled_by IS NOT NULL
          AND cancelled_at IS NOT NULL
          AND NULLIF(BTRIM(cancellation_reason), '') IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END
$$;

-- Keep the constraint definition consistent in environments created before
-- Cancelled became a supported state.
ALTER TABLE v4.return_home_tbl
  DROP CONSTRAINT IF EXISTS check_return_home_status;

ALTER TABLE v4.return_home_tbl
  DROP CONSTRAINT IF EXISTS return_home_tbl_status_check;

ALTER TABLE v4.return_home_tbl
  ADD CONSTRAINT check_return_home_status
  CHECK (status IN ('Draft', 'Pending', 'Approved', 'Rejected', 'Cancelled'));

CREATE OR REPLACE FUNCTION v4.fn_return_home_cancellation_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_changed_by UUID;
BEGIN
  v_changed_by := COALESCE(NEW.updated_by, NEW.cancelled_by, NEW.created_by);

  IF OLD.cancelled_by IS DISTINCT FROM NEW.cancelled_by THEN
    INSERT INTO v4.app_audit_log
      (source_table, record_id, operation, field_name, old_value, new_value,
       changed_by, user_id, business_unit)
    VALUES
      ('return_home_tbl', NEW.id, 'UPDATE', 'cancelled_by',
       OLD.cancelled_by::TEXT, NEW.cancelled_by::TEXT,
       v_changed_by, NEW.user_id, NEW.business_unit);
  END IF;

  IF OLD.cancelled_at IS DISTINCT FROM NEW.cancelled_at THEN
    INSERT INTO v4.app_audit_log
      (source_table, record_id, operation, field_name, old_value, new_value,
       changed_by, user_id, business_unit)
    VALUES
      ('return_home_tbl', NEW.id, 'UPDATE', 'cancelled_at',
       OLD.cancelled_at::TEXT, NEW.cancelled_at::TEXT,
       v_changed_by, NEW.user_id, NEW.business_unit);
  END IF;

  IF OLD.cancellation_reason IS DISTINCT FROM NEW.cancellation_reason THEN
    INSERT INTO v4.app_audit_log
      (source_table, record_id, operation, field_name, old_value, new_value,
       changed_by, user_id, business_unit)
    VALUES
      ('return_home_tbl', NEW.id, 'UPDATE', 'cancellation_reason',
       OLD.cancellation_reason, NEW.cancellation_reason,
       v_changed_by, NEW.user_id, NEW.business_unit);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_return_home_cancellation_audit
  ON v4.return_home_tbl;

CREATE TRIGGER trg_return_home_cancellation_audit
AFTER UPDATE OF cancelled_by, cancelled_at, cancellation_reason
ON v4.return_home_tbl
FOR EACH ROW
EXECUTE FUNCTION v4.fn_return_home_cancellation_audit();

COMMIT;
