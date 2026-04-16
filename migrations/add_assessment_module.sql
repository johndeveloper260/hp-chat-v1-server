-- Assessment Module Migration
-- Run this script once against the target database.

-- 1. Add assessment_enabled flag to business_unit_tbl
ALTER TABLE v4.business_unit_tbl
  ADD COLUMN IF NOT EXISTS assessment_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Assessment definitions
CREATE TABLE IF NOT EXISTS v4.assessment_tbl (
  assessment_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  business_unit        TEXT        NOT NULL,
  title                TEXT        NOT NULL,
  description          TEXT,
  passing_score        INTEGER     NOT NULL DEFAULT 70,
  time_limit_seconds   INTEGER,
  allow_retake         BOOLEAN     NOT NULL DEFAULT TRUE,
  is_published         BOOLEAN     NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN     NOT NULL DEFAULT TRUE,
  audience_mode        TEXT        NOT NULL DEFAULT 'all',
  audience_country     TEXT[],
  audience_company     UUID[],
  audience_batch       TEXT[],
  audience_visa_type   TEXT[],
  created_by           UUID        NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Questions
CREATE TABLE IF NOT EXISTS v4.assessment_question_tbl (
  question_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id    UUID        NOT NULL REFERENCES v4.assessment_tbl(assessment_id) ON DELETE CASCADE,
  question_order   INTEGER     NOT NULL,
  question_type    TEXT        NOT NULL,
  prompt           TEXT        NOT NULL,
  options          JSONB,
  correct_answer   TEXT,
  points           INTEGER     NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_question_assessment_id
  ON v4.assessment_question_tbl(assessment_id);

-- 4. Attempts
CREATE TABLE IF NOT EXISTS v4.assessment_attempt_tbl (
  attempt_id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id          UUID        NOT NULL REFERENCES v4.assessment_tbl(assessment_id),
  user_id                UUID        NOT NULL,
  business_unit          TEXT        NOT NULL,
  status                 TEXT        NOT NULL DEFAULT 'in_progress',
  score                  INTEGER,
  passed                 BOOLEAN,
  answers                JSONB       NOT NULL DEFAULT '{}',
  current_question_index INTEGER     NOT NULL DEFAULT 0,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_attempt_user
  ON v4.assessment_attempt_tbl(user_id, business_unit);
CREATE INDEX IF NOT EXISTS idx_assessment_attempt_assessment
  ON v4.assessment_attempt_tbl(assessment_id);

-- 5. Add role definitions
INSERT INTO v4.role_definitions (role_name, module, access_level, description)
VALUES
  ('assessments_read',  'assessments', 'read',  'View and list assessments and results'),
  ('assessments_write', 'assessments', 'write', 'Create, edit, publish, and delete assessments')
ON CONFLICT (role_name) DO NOTHING;
