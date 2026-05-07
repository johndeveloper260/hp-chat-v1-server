/**
 * Assessment Repository
 * Raw SQL only — no business logic.
 */
import { getPool } from "../config/getPool.js";

const db = (client) => client ?? getPool();

// ─── Assessment CRUD ───────────────────────────────────────────────────────────

export async function createAssessment({
  businessUnit, title, description, passing_score, time_limit_seconds,
  allow_retake, audience_mode, audience_country, audience_company,
  audience_batch, audience_visa_type, created_by,
}, client) {
  const { rows } = await db(client).query(
    `INSERT INTO v4.assessment_tbl (
       business_unit, title, description, passing_score, time_limit_seconds,
       allow_retake, audience_mode, audience_country, audience_company,
       audience_batch, audience_visa_type, created_by
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      businessUnit, title, description ?? null, passing_score, time_limit_seconds ?? null,
      allow_retake, audience_mode,
      audience_country?.length ? audience_country : null,
      audience_company?.length ? audience_company : null,
      audience_batch?.length ? audience_batch : null,
      audience_visa_type?.length ? audience_visa_type : null,
      created_by,
    ],
  );
  return rows[0];
}

export async function insertQuestions(assessmentId, questions, client) {
  if (!questions.length) return;
  const values = questions.map((q, i) => {
    const base = i * 7;
    return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7})`;
  }).join(",");
  const params = questions.flatMap((q) => [
    assessmentId,
    q.question_order,
    q.question_type,
    q.prompt,
    q.options ? JSON.stringify(q.options) : null,
    q.correct_answer ?? null,
    q.points ?? 1,
  ]);
  await db(client).query(
    `INSERT INTO v4.assessment_question_tbl
       (assessment_id, question_order, question_type, prompt, options, correct_answer, points)
     VALUES ${values}`,
    params,
  );
}

export async function deleteQuestionsByAssessmentId(assessmentId, client) {
  await db(client).query(
    `DELETE FROM v4.assessment_question_tbl WHERE assessment_id = $1`,
    [assessmentId],
  );
}

export async function updateAssessment(assessmentId, businessUnit, fields, client) {
  const setClauses = [];
  const params = [];
  let idx = 1;

  const allowed = [
    "title", "description", "passing_score", "time_limit_seconds", "allow_retake",
    "audience_mode", "audience_country", "audience_company", "audience_batch", "audience_visa_type",
  ];
  for (const key of allowed) {
    if (key in fields) {
      setClauses.push(`${key} = $${idx++}`);
      let val = fields[key];
      if (["audience_country","audience_company","audience_batch","audience_visa_type"].includes(key)) {
        val = val?.length ? val : null;
      }
      params.push(val ?? null);
    }
  }

  if (!setClauses.length) return null;
  setClauses.push(`updated_at = NOW()`);
  params.push(assessmentId, businessUnit);

  const { rows } = await db(client).query(
    `UPDATE v4.assessment_tbl SET ${setClauses.join(",")}
     WHERE assessment_id = $${idx++} AND business_unit = $${idx} AND is_active = true
     RETURNING *`,
    params,
  );
  return rows[0] ?? null;
}

export async function togglePublish(assessmentId, businessUnit, client) {
  const { rows } = await db(client).query(
    `UPDATE v4.assessment_tbl
     SET is_published = NOT is_published, updated_at = NOW()
     WHERE assessment_id = $1 AND business_unit = $2 AND is_active = true
     RETURNING *`,
    [assessmentId, businessUnit],
  );
  return rows[0] ?? null;
}

export async function softDeleteAssessment(assessmentId, businessUnit, client) {
  const { rows } = await db(client).query(
    `UPDATE v4.assessment_tbl
     SET is_active = false, updated_at = NOW()
     WHERE assessment_id = $1 AND business_unit = $2
     RETURNING assessment_id`,
    [assessmentId, businessUnit],
  );
  return rows[0] ?? null;
}

export async function findAssessmentById(assessmentId, businessUnit, client) {
  const { rows } = await db(client).query(
    `SELECT a.*,
       COALESCE(json_agg(q ORDER BY q.question_order) FILTER (WHERE q.question_id IS NOT NULL), '[]') AS questions
     FROM v4.assessment_tbl a
     LEFT JOIN v4.assessment_question_tbl q ON q.assessment_id = a.assessment_id
     WHERE a.assessment_id = $1 AND a.business_unit = $2 AND a.is_active = true
     GROUP BY a.assessment_id`,
    [assessmentId, businessUnit],
  );
  return rows[0] ?? null;
}

export async function findAssessmentByIdForUser(assessmentId, businessUnit, userId, client) {
  const { rows } = await db(client).query(
    `SELECT a.*,
       -- Questions without correct_answer to prevent answer leakage
       COALESCE(
         json_agg(
           json_build_object(
             'question_id',    q.question_id,
             'question_order', q.question_order,
             'question_type',  q.question_type,
             'prompt',         q.prompt,
             'options',        q.options,
             'points',         q.points
           )
           ORDER BY q.question_order
         ) FILTER (WHERE q.question_id IS NOT NULL),
         '[]'
       ) AS questions,
       -- In-progress attempt for resume (includes saved answers as plain strings)
       (
         SELECT json_build_object(
           'attempt_id',             lat.attempt_id,
           'current_question_index', lat.current_question_index,
           'started_at',             lat.started_at,
           'answers',                lat.answers
         )
         FROM v4.assessment_attempt_tbl lat
         WHERE lat.assessment_id = a.assessment_id AND lat.user_id = $3
           AND lat.status = 'in_progress'
         LIMIT 1
       ) AS in_progress_attempt,
       -- Latest completed attempt for score display (no per-question scoring data)
       (
         SELECT json_build_object(
           'attempt_id',   lat.attempt_id,
           'score',        lat.score,
           'passed',       lat.passed,
           'completed_at', lat.completed_at
         )
         FROM v4.assessment_attempt_tbl lat
         WHERE lat.assessment_id = a.assessment_id AND lat.user_id = $3
           AND lat.status = 'completed'
         ORDER BY lat.completed_at DESC LIMIT 1
       ) AS latest_completed_attempt,
       (
         SELECT COUNT(*) FROM v4.assessment_attempt_tbl
         WHERE assessment_id = a.assessment_id AND user_id = $3 AND status = 'completed'
       )::int AS completed_attempts
     FROM v4.assessment_tbl a
     LEFT JOIN v4.assessment_question_tbl q ON q.assessment_id = a.assessment_id
     WHERE a.assessment_id = $1 AND a.business_unit = $2 AND a.is_active = true
     GROUP BY a.assessment_id`,
    [assessmentId, businessUnit, userId],
  );
  return rows[0] ?? null;
}

export async function getUserAudienceProfile(userId, client) {
  const { rows } = await db(client).query(
    `SELECT p.company, p.batch_no, p.country, v.visa_type
     FROM v4.user_profile_tbl p
     LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = p.user_id
     WHERE p.user_id = $1
     LIMIT 1`,
    [userId],
  );
  return rows[0] ?? {};
}

export async function findInProgressAttempt(assessmentId, userId, client) {
  const { rows } = await db(client).query(
    `SELECT * FROM v4.assessment_attempt_tbl
     WHERE assessment_id = $1 AND user_id = $2 AND status = 'in_progress'
     ORDER BY started_at DESC LIMIT 1`,
    [assessmentId, userId],
  );
  return rows[0] ?? null;
}

export async function abandonInProgressAttempts(assessmentId, userId, client) {
  await db(client).query(
    `UPDATE v4.assessment_attempt_tbl
     SET status = 'timed_out', updated_at = NOW()
     WHERE assessment_id = $1 AND user_id = $2 AND status = 'in_progress'`,
    [assessmentId, userId],
  );
}

export async function findLastCompletedAttempt(assessmentId, userId, client) {
  const { rows } = await db(client).query(
    `SELECT * FROM v4.assessment_attempt_tbl
     WHERE assessment_id = $1 AND user_id = $2 AND status = 'completed'
     ORDER BY completed_at DESC LIMIT 1`,
    [assessmentId, userId],
  );
  return rows[0] ?? null;
}

export async function listAssessmentsForCoordinator(businessUnit, client) {
  const { rows } = await db(client).query(
    `SELECT a.*,
       COUNT(DISTINCT at2.attempt_id) AS total_attempts,
       COUNT(DISTINCT at2.user_id) AS total_participants,
       ROUND(AVG(at2.score) FILTER (WHERE at2.status = 'completed'), 1) AS avg_score,
       ROUND(
         100.0 * COUNT(DISTINCT at2.attempt_id) FILTER (WHERE at2.passed = true AND at2.status = 'completed') /
         NULLIF(COUNT(DISTINCT at2.attempt_id) FILTER (WHERE at2.status = 'completed'), 0)
       , 1) AS pass_rate,
       (SELECT COUNT(*) FROM v4.assessment_question_tbl WHERE assessment_id = a.assessment_id)::int AS question_count
     FROM v4.assessment_tbl a
     LEFT JOIN v4.assessment_attempt_tbl at2 ON at2.assessment_id = a.assessment_id
     WHERE a.business_unit = $1 AND a.is_active = true
     GROUP BY a.assessment_id
     ORDER BY a.created_at DESC`,
    [businessUnit],
  );
  return rows;
}

export async function listAssessmentsForUser(userId, businessUnit, client) {
  // Fetch user profile attributes needed for audience filtering
  const { rows: profileRows } = await db(client).query(
    `SELECT p.company, p.batch_no, p.country, v.visa_type
     FROM v4.user_profile_tbl p
     LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = p.user_id
     WHERE p.user_id = $1
     LIMIT 1`,
    [userId],
  );
  const profile = profileRows[0] ?? {};

  // Fetch eligible published assessments for this BU
  const { rows } = await db(client).query(
    `SELECT a.assessment_id, a.title, a.description, a.passing_score,
       a.time_limit_seconds, a.allow_retake, a.audience_mode,
       a.audience_country, a.audience_company, a.audience_batch, a.audience_visa_type,
       (SELECT COUNT(*) FROM v4.assessment_question_tbl WHERE assessment_id = a.assessment_id)::int AS question_count,
       (
         SELECT json_build_object(
           'attempt_id',             lat.attempt_id,
           'current_question_index', lat.current_question_index,
           'started_at',             lat.started_at
         )
         FROM v4.assessment_attempt_tbl lat
         WHERE lat.assessment_id = a.assessment_id AND lat.user_id = $2
           AND lat.status = 'in_progress'
         LIMIT 1
       ) AS in_progress_attempt,
       (
         SELECT json_build_object(
           'attempt_id',   lat.attempt_id,
           'score',        lat.score,
           'passed',       lat.passed,
           'completed_at', lat.completed_at
         )
         FROM v4.assessment_attempt_tbl lat
         WHERE lat.assessment_id = a.assessment_id AND lat.user_id = $2
           AND lat.status = 'completed'
         ORDER BY lat.completed_at DESC LIMIT 1
       ) AS latest_completed_attempt,
       (
         SELECT COUNT(*) FROM v4.assessment_attempt_tbl
         WHERE assessment_id = a.assessment_id AND user_id = $2 AND status = 'completed'
       )::int AS completed_attempts
     FROM v4.assessment_tbl a
     WHERE a.business_unit = $1 AND a.is_active = true AND a.is_published = true
     ORDER BY a.created_at DESC`,
    [businessUnit, userId],
  );

  // Filter by audience in JS (simpler than complex SQL arrays)
  return rows.filter((a) => {
    if (a.audience_mode === "all") return true;
    const companyId = profile.company ? String(profile.company) : null;
    const matchCountry = !a.audience_country?.length || (profile.country && a.audience_country.includes(profile.country));
    const matchCompany = !a.audience_company?.length || (companyId && a.audience_company.map(String).includes(companyId));
    const matchBatch   = !a.audience_batch?.length   || (profile.batch_no && a.audience_batch.includes(profile.batch_no));
    const matchVisa    = !a.audience_visa_type?.length || (profile.visa_type && a.audience_visa_type.includes(profile.visa_type));
    return matchCountry && matchCompany && matchBatch && matchVisa;
  });
}

// ─── Attempts ─────────────────────────────────────────────────────────────────

export async function createAttempt({ assessmentId, userId, businessUnit }, client) {
  const { rows } = await db(client).query(
    `INSERT INTO v4.assessment_attempt_tbl
       (assessment_id, user_id, business_unit, status, answers, current_question_index)
     VALUES ($1, $2, $3, 'in_progress', '{}'::jsonb, 0)
     ON CONFLICT (assessment_id, user_id) WHERE status = 'in_progress'
     DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [assessmentId, userId, businessUnit],
  );
  return rows[0];
}

export async function findAttemptById(attemptId, client) {
  const { rows } = await db(client).query(
    `SELECT at.*, a.time_limit_seconds, a.allow_retake, a.passing_score
     FROM v4.assessment_attempt_tbl at
     JOIN v4.assessment_tbl a ON a.assessment_id = at.assessment_id
     WHERE at.attempt_id = $1`,
    [attemptId],
  );
  return rows[0] ?? null;
}

export async function autoSaveAttempt(attemptId, userId, answers, currentQuestionIndex, client) {
  const { rows } = await db(client).query(
    `UPDATE v4.assessment_attempt_tbl
     SET answers = $1::jsonb, current_question_index = $2, updated_at = NOW()
     WHERE attempt_id = $3 AND user_id = $4 AND status = 'in_progress'
     RETURNING *`,
    [JSON.stringify(answers), currentQuestionIndex ?? 0, attemptId, userId],
  );
  return rows[0] ?? null;
}

export async function completeAttempt(attemptId, userId, { score, passed, answers }, client) {
  const { rows } = await db(client).query(
    `UPDATE v4.assessment_attempt_tbl
     SET status = 'completed', score = $1, passed = $2,
         answers = $3::jsonb, completed_at = NOW(), updated_at = NOW()
     WHERE attempt_id = $4 AND user_id = $5 AND status = 'in_progress'
     RETURNING *`,
    [score, passed, JSON.stringify(answers), attemptId, userId],
  );
  return rows[0] ?? null;
}

export async function getMyAttemptHistory(userId, businessUnit, client) {
  const { rows } = await db(client).query(
    `SELECT at.attempt_id, at.assessment_id, at.status, at.score, at.passed,
       at.started_at, at.completed_at,
       a.title AS assessment_title, a.passing_score
     FROM v4.assessment_attempt_tbl at
     JOIN v4.assessment_tbl a ON a.assessment_id = at.assessment_id
     WHERE at.user_id = $1 AND at.business_unit = $2
     ORDER BY at.created_at DESC`,
    [userId, businessUnit],
  );
  return rows;
}

export async function getAssessmentResults(assessmentId, businessUnit, filters, client) {
  const { country, company, batch, visa_type } = filters;
  const { rows } = await db(client).query(
    `SELECT
       at.attempt_id, at.user_id, at.status, at.score, at.passed,
       at.started_at, at.completed_at,
       TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS full_name,
       p.country,
       p.company AS company_id,
       COALESCE(c.company_name->>'en', c.company_name->>'ja') AS company_name,
       p.batch_no, v.visa_type
     FROM v4.assessment_attempt_tbl at
     JOIN v4.user_profile_tbl p ON p.user_id = at.user_id
     LEFT JOIN v4.company_tbl c ON c.company_id = p.company::uuid
     LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = at.user_id
     WHERE at.assessment_id = $1 AND at.business_unit = $2
       AND ($3::text IS NULL OR p.batch_no = $3)
       AND ($4::uuid IS NULL OR p.company::uuid = $4::uuid)
       AND ($5::text IS NULL OR v.visa_type = $5)
       AND ($6::text IS NULL OR UPPER(p.country) = UPPER($6))
     ORDER BY at.created_at DESC`,
    [assessmentId, businessUnit, batch ?? null, company ?? null, visa_type ?? null, country ?? null],
  );
  return rows;
}

export async function findQuestionsForAttempt(assessmentId, client) {
  const { rows } = await db(client).query(
    `SELECT question_id, question_order, question_type, prompt, options, correct_answer, points
     FROM v4.assessment_question_tbl
     WHERE assessment_id = $1
     ORDER BY question_order`,
    [assessmentId],
  );
  return rows;
}
