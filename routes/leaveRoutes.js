import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  saveLeaveTemplate,
  getLeaveTemplate,
  getCompanyTemplates,
  submitLeave,
  getCompanySubmissions,
  getMySubmissions,
} from "../controller/leaveController.js";

const router = express.Router();

// ── All authenticated users ───────────────────────────────────────────────────
router.get("/template",      auth, getLeaveTemplate);   // read the form to fill it in
router.post("/submit",       auth, submitLeave);
router.get("/my-submissions", auth, getMySubmissions);

// ── leave_read (or leave_write) ───────────────────────────────────────────────
router.get("/templates",    auth, requireRole("leave_read"), getCompanyTemplates);
router.get("/submissions",  auth, requireRole("leave_read"), getCompanySubmissions);

// ── leave_write ───────────────────────────────────────────────────────────────
router.post("/template", auth, requireRole("leave_write"), saveLeaveTemplate);

export default router;
