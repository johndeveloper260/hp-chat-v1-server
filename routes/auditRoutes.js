import express from "express";
import auth from "../middleware/auth.js";
import {
  getAuditByRecord,
  getAuditByUser,
  searchAuditLog,
} from "../controller/auditController.js";

const router = express.Router();

/**
 * @route   GET /audit/record/:sourceTable/:recordId
 * @desc    Get full audit history for a specific record
 * @access  Authenticated — non-elevated users limited to their own records
 * @example GET /audit/record/return_home_tbl/42
 * @example GET /audit/record/inquiry_tbl/15
 */
router.get("/record/:sourceTable/:recordId", auth, getAuditByRecord);

/**
 * @route   GET /audit/user/:userId
 * @desc    Get all changes made BY a specific user (who changed what)
 * @access  OFFICER / ADMIN only
 * @query   source_table?, limit?, offset?
 */
router.get("/user/:userId", auth, getAuditByUser);

/**
 * @route   GET /audit/search
 * @desc    Filtered audit trail for the audit log page
 * @access  OFFICER / ADMIN only
 * @query   source_table?, field_name?, changed_by?, user_id?, date_from?, date_to?, limit?, offset?
 */
router.get("/search", auth, searchAuditLog);

export default router;
