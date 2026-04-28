/**
 * Assessment Service
 * Business logic only — no req/res.
 */
import { getPool } from "../config/getPool.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../errors/AppError.js";
import * as repo from "../repositories/assessmentRepository.js";

// ─── Coordinator ──────────────────────────────────────────────────────────────

export async function createAssessment(userId, businessUnit, body) {
  const { questions, ...assessmentData } = body;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const assessment = await repo.createAssessment({ ...assessmentData, businessUnit, created_by: userId }, client);
    await repo.insertQuestions(assessment.assessment_id, questions, client);
    await client.query("COMMIT");
    return await repo.findAssessmentById(assessment.assessment_id, businessUnit);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateAssessment(assessmentId, userId, businessUnit, body) {
  const { questions, ...fields } = body;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const updated = await repo.updateAssessment(assessmentId, businessUnit, fields, client);
    if (!updated) throw new NotFoundError("assessment_not_found");
    if (questions) {
      await repo.deleteQuestionsByAssessmentId(assessmentId, client);
      await repo.insertQuestions(assessmentId, questions, client);
    }
    await client.query("COMMIT");
    return await repo.findAssessmentById(assessmentId, businessUnit);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function importQuestions(assessmentId, businessUnit, questions) {
  const assessment = await repo.findAssessmentById(assessmentId, businessUnit);
  if (!assessment) throw new NotFoundError("assessment_not_found");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await repo.deleteQuestionsByAssessmentId(assessmentId, client);
    await repo.insertQuestions(assessmentId, questions, client);
    await client.query("COMMIT");
    return await repo.findAssessmentById(assessmentId, businessUnit);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function togglePublish(assessmentId, businessUnit) {
  const result = await repo.togglePublish(assessmentId, businessUnit);
  if (!result) throw new NotFoundError("assessment_not_found");
  return result;
}

export async function deleteAssessment(assessmentId, businessUnit) {
  const result = await repo.softDeleteAssessment(assessmentId, businessUnit);
  if (!result) throw new NotFoundError("assessment_not_found");
}

export async function getAssessment(assessmentId, businessUnit) {
  const assessment = await repo.findAssessmentById(assessmentId, businessUnit);
  if (!assessment) throw new NotFoundError("assessment_not_found");
  return assessment;
}

async function assertLearnerCanAccessAssessment(assessment, userId) {
  if (!assessment.is_published) throw new ForbiddenError("assessment_not_available");

  // Audience eligibility — mirrors listAssessmentsForUser filter.
  if (assessment.audience_mode === "filtered") {
    const profile = await repo.getUserAudienceProfile(userId);
    const companyId = profile.company ? String(profile.company) : null;
    const matchCountry = !assessment.audience_country?.length ||
      (profile.country && assessment.audience_country.includes(profile.country));
    const matchCompany = !assessment.audience_company?.length ||
      (companyId && assessment.audience_company.map(String).includes(companyId));
    const matchBatch = !assessment.audience_batch?.length ||
      (profile.batch_no && assessment.audience_batch.includes(profile.batch_no));
    const matchVisa = !assessment.audience_visa_type?.length ||
      (profile.visa_type && assessment.audience_visa_type.includes(profile.visa_type));
    if (!matchCountry || !matchCompany || !matchBatch || !matchVisa) {
      throw new ForbiddenError("assessment_not_available");
    }
  }
}

export async function getAssessmentForUser(assessmentId, userId, businessUnit) {
  const assessment = await repo.findAssessmentByIdForUser(assessmentId, businessUnit, userId);
  if (!assessment) throw new NotFoundError("assessment_not_found");
  await assertLearnerCanAccessAssessment(assessment, userId);

  return assessment;
}

export async function listAssessments(userId, businessUnit, userType) {
  const isOfficer = ["OFFICER","ADMIN"].includes((userType || "").toUpperCase());
  if (isOfficer) {
    return repo.listAssessmentsForCoordinator(businessUnit);
  }
  return repo.listAssessmentsForUser(userId, businessUnit);
}

export async function getResults(assessmentId, businessUnit, filters) {
  const assessment = await repo.findAssessmentById(assessmentId, businessUnit);
  if (!assessment) throw new NotFoundError("assessment_not_found");
  return repo.getAssessmentResults(assessmentId, businessUnit, filters);
}

// ─── Attempts ─────────────────────────────────────────────────────────────────

export async function startAttempt(assessmentId, userId, businessUnit, userType, force = false) {
  const isOfficer = ["OFFICER","ADMIN"].includes((userType || "").toUpperCase());
  const assessment = await repo.findAssessmentById(assessmentId, businessUnit);
  if (!assessment) throw new NotFoundError("assessment_not_found");
  if (!isOfficer) await assertLearnerCanAccessAssessment(assessment, userId);

  if (!force) {
    // Return existing in-progress attempt so users can resume without duplicates
    const inProgress = await repo.findInProgressAttempt(assessmentId, userId);
    if (inProgress) return inProgress;
  } else {
    // Abandon all in-progress attempts for a clean restart
    await repo.abandonInProgressAttempts(assessmentId, userId);
  }

  // Enforce allow_retake=false for non-officers
  if (!isOfficer && !assessment.allow_retake) {
    const lastCompleted = await repo.findLastCompletedAttempt(assessmentId, userId);
    if (lastCompleted) throw new ForbiddenError("assessment_retake_not_allowed");
  }

  return repo.createAttempt({ assessmentId, userId, businessUnit });
}

export async function autoSave(attemptId, userId, { answers, current_question_index }) {
  const attempt = await repo.findAttemptById(attemptId);
  if (!attempt) throw new NotFoundError("attempt_not_found");
  if (String(attempt.user_id) !== String(userId)) throw new ForbiddenError();
  if (attempt.status !== "in_progress") throw new ValidationError("attempt_already_completed");
  return repo.autoSaveAttempt(attemptId, userId, answers, current_question_index);
}

export async function submitAttempt(attemptId, userId, { answers }) {
  const attempt = await repo.findAttemptById(attemptId);
  if (!attempt) throw new NotFoundError("attempt_not_found");
  if (String(attempt.user_id) !== String(userId)) throw new ForbiddenError();
  if (attempt.status !== "in_progress") throw new ValidationError("attempt_already_completed");

  const questions = await repo.findQuestionsForAttempt(attempt.assessment_id);

  // Score calculation
  let earnedPoints = 0;
  let totalPoints = 0;
  const scoredAnswers = {};

  for (const q of questions) {
    totalPoints += q.points;
    const userAnswer = answers[q.question_id];
    scoredAnswers[q.question_id] = { response: userAnswer ?? null, isCorrect: false, pointsEarned: 0 };

    if (!userAnswer) continue;

    if (q.question_type === "text") {
      const isCorrect = q.correct_answer != null && q.correct_answer !== "" &&
        userAnswer.trim().toLowerCase() === q.correct_answer.trim().toLowerCase();
      if (isCorrect) { earnedPoints += q.points; scoredAnswers[q.question_id].isCorrect = true; scoredAnswers[q.question_id].pointsEarned = q.points; }
    } else {
      const isCorrect = q.correct_answer != null && q.correct_answer !== "" &&
        userAnswer.trim() === q.correct_answer.trim();
      if (isCorrect) { earnedPoints += q.points; scoredAnswers[q.question_id].isCorrect = true; scoredAnswers[q.question_id].pointsEarned = q.points; }
    }
  }

  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passed = score >= (attempt.passing_score ?? 70);

  return repo.completeAttempt(attemptId, userId, { score, passed, answers: scoredAnswers });
}

export async function getMyHistory(userId, businessUnit) {
  return repo.getMyAttemptHistory(userId, businessUnit);
}
