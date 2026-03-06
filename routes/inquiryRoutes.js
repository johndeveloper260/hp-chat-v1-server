import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  searchInquiries,
  createInquiry,
  updateInquiry,
  deleteInquiry,
  getIssues,
  getOfficersByBU,
} from "../controller/inquiryController.js";

const router = express.Router();

// ── All authenticated users ───────────────────────────────────────────────────
// Controllers filter to own records for non-officers internally
router.post("/create",         auth, createInquiry);
router.get("/issues",          auth, getIssues);
router.get("/getOfficersByBU", auth, getOfficersByBU);
router.get("/search",          auth, searchInquiries);   // controller scopes by role

// ── inquiries_write ───────────────────────────────────────────────────────────
router.put("/update/:ticketId",    auth, requireRole("inquiries_write"), updateInquiry);
router.delete("/delete/:ticketId", auth, requireRole("inquiries_write"), deleteInquiry);

export default router;
