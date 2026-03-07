/**
 * Inquiry Routes
 */
import express from "express";
import auth               from "../middleware/auth.js";
import { requireRole }    from "../middleware/requireRole.js";
import { validate }       from "../middleware/validate.js";
import {
  createInquirySchema,
  updateInquirySchema,
} from "../validators/inquiryValidator.js";
import {
  searchInquiries,
  createInquiry,
  updateInquiry,
  deleteInquiry,
  getIssues,
  getOfficersByBU,
} from "../controller/inquiryController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
// Controller scopes to own records for non-OFFICER roles internally
router.post("/create",         auth, validate(createInquirySchema), createInquiry);
router.get("/issues",          auth, getIssues);
router.get("/getOfficersByBU", auth, getOfficersByBU);
router.get("/search",          auth, searchInquiries);   // controller scopes by role

// ── inquiries_write ────────────────────────────────────────────────────────────
router.put("/update/:ticketId",    auth, requireRole("inquiries_write"), validate(updateInquirySchema), updateInquiry);
router.delete("/delete/:ticketId", auth, requireRole("inquiries_write"), deleteInquiry);

export default router;
