import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

import {
  saveLeaveTemplate,
  getLeaveTemplate,
  submitLeave,
  getCompanySubmissions,
  getMySubmissions,
} from "../controller/leaveController.js";

/**
 * @route   GET /api/leave/template
 * @desc    Get the dynamic form template for the user's company
 */
router.get("/template", auth, getLeaveTemplate);

/**
 * @route   POST /api/leave/template
 * @desc    Create or update the dynamic form template (Admin)
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
