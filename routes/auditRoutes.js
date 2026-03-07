/**
 * Audit Routes
 *
 * All GET — no body validation needed.
 * Non-elevated users are scope-limited by the service layer.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { getAuditByRecord, getAuditByUser, searchAuditLog } from "../controller/auditController.js";

const router = express.Router();

router.get("/record/:sourceTable/:recordId", auth,                              getAuditByRecord);
router.get("/user/:userId",                  auth, requireRole("inquiries_read"), getAuditByUser);
router.get("/search",                        auth, requireRole("inquiries_read"), searchAuditLog);

export default router;
