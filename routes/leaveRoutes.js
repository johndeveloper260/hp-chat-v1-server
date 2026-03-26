/**
 * Leave Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate }    from "../middleware/validate.js";
import {
  saveLeaveTemplateSchema,
  submitLeaveSchema,
} from "../validators/leaveValidator.js";
import {
  deleteLeaveTemplate,
  saveLeaveTemplate,
  getLeaveTemplate,
  getCompanyTemplates,
  submitLeave,
  getCompanySubmissions,
  getMySubmissions,
} from "../controller/leaveController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
router.get("/template",       auth, getLeaveTemplate);
router.post("/submit",        auth, validate(submitLeaveSchema), submitLeave);
router.get("/my-submissions", auth, getMySubmissions);

// ── All authenticated users (published only for non-officers) ─────────────────
router.get("/templates",   auth, getCompanyTemplates);
router.get("/submissions", auth, requireRole("leave_read"), getCompanySubmissions);

// ── leave_write ───────────────────────────────────────────────────────────────
router.post("/template",              auth, requireRole("leave_write"), validate(saveLeaveTemplateSchema), saveLeaveTemplate);
router.delete("/template/:templateId", auth, requireRole("leave_write"), deleteLeaveTemplate);

export default router;
