/**
 * Issue Type Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createIssueTypeSchema, updateIssueTypeSchema } from "../validators/issueTypeValidator.js";
import {
  getIssueTypeList,
  createIssueType,
  updateIssueType,
  deleteIssueType,
} from "../controller/issueTypeController.js";

const router = express.Router();

// ── visa_read ──────────────────────────────────────────────────────────────────
router.get("/list", auth, requireRole("visa_read"), getIssueTypeList);

// ── visa_write ─────────────────────────────────────────────────────────────────
router.post(  "/create",         auth, requireRole("visa_write"), validate(createIssueTypeSchema), createIssueType);
router.put(   "/update/:code",   auth, requireRole("visa_write"), validate(updateIssueTypeSchema), updateIssueType);
router.delete("/delete/:code",   auth, requireRole("visa_write"),                                  deleteIssueType);

export default router;
