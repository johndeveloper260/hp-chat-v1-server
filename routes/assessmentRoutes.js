/**
 * Assessment Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  createAssessmentSchema,
  updateAssessmentSchema,
  importQuestionsSchema,
  autoSaveSchema,
  submitAttemptSchema,
} from "../validators/assessmentValidator.js";
import {
  listAssessments,
  getAssessment,
  createAssessment,
  updateAssessment,
  deleteAssessment,
  togglePublish,
  importQuestions,
  getResults,
  startAttempt,
  autoSave,
  submitAttempt,
  getMyHistory,
} from "../controller/assessmentController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
router.get("/",                                    auth, listAssessments);
router.get("/attempts/history",                    auth, getMyHistory);
router.get("/:id",                                 auth, getAssessment);
router.post("/:id/attempts",                       auth, startAttempt);
router.patch("/attempts/:attemptId/save",          auth, validate(autoSaveSchema), autoSave);
router.post("/attempts/:attemptId/submit",         auth, validate(submitAttemptSchema), submitAttempt);

// ── assessment_write (coordinators) ───────────────────────────────────────────
router.post("/",              auth, requireRole("assessments_write"), validate(createAssessmentSchema), createAssessment);
router.patch("/:id",          auth, requireRole("assessments_write"), validate(updateAssessmentSchema), updateAssessment);
router.delete("/:id",         auth, requireRole("assessments_write"), deleteAssessment);
router.patch("/:id/publish",  auth, requireRole("assessments_write"), togglePublish);
router.post("/:id/import",    auth, requireRole("assessments_write"), validate(importQuestionsSchema), importQuestions);
router.get("/:id/results",    auth, requireRole("assessments_read"),  getResults);

export default router;
