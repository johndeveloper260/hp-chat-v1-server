import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getAuditByRecord,
  getAuditByUser,
  searchAuditLog,
} from "../controller/auditController.js";

const router = express.Router();

/**
 * @route   GET /audit/record/:sourceTable/:recordId
 * @desc    Audit history for a specific record.
 *          Non-elevated users are limited to their own records in the controller.
 *          Officers need at least read access to the relevant module.
 */
router.get("/record/:sourceTable/:recordId", auth, getAuditByRecord);

/**
 * @route   GET /audit/user/:userId
 * @route   GET /audit/search
 * @desc    Broader audit views — require at least one read-level role.
 *          Full-access officers (no roles) bypass via requireRole Strategy A.
 */
router.get("/user/:userId", auth, requireRole("inquiries_read"), getAuditByUser);
router.get("/search",       auth, requireRole("inquiries_read"), searchAuditLog);

export default router;
