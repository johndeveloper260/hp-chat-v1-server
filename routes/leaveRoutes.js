import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

import {
  saveLeaveTemplate,
  getLeaveTemplate,
  getCompanyTemplates,
  submitLeave,
  getCompanySubmissions,
  getMySubmissions,
} from "../controller/leaveController.js";

/**
 * @route   GET /api/leave/templates
 * @desc    Get all active form templates for a company (Admin/Officer)
 */
router.get("/templates", auth, getCompanyTemplates);

/**
 * @route   GET /api/leave/template
 * @desc    Get a specific template by template_id, or the latest for the company
 */
router.get("/template", auth, getLeaveTemplate);

/**
 * @route   POST /api/leave/template
 * @desc    Create a new template (no template_id) or update an existing one (with template_id)
 */
router.post("/template", auth, saveLeaveTemplate);

/**
 * @route   POST /api/leave/submit
 * @desc    Submit a leave application based on the template
 */
router.post("/submit", auth, submitLeave);

/**
 * @route   GET /api/leave/submissions
 * @desc    Get all leave submissions for a company (Admin/Officer)
 */
router.get("/submissions", auth, getCompanySubmissions);

/**
 * @route   GET /api/leave/my-submissions
 * @desc    Get the current user's own leave submissions
 */
router.get("/my-submissions", auth, getMySubmissions);

export default router;
