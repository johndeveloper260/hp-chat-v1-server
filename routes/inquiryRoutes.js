import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Changed require to a named import and added .js
import {
  searchInquiries,
  createInquiry,
  updateInquiry,
  deleteInquiry,
  getIssues,
  getOfficersByBU,
} from "../controller/inquiryController.js";

/**
 * @route   GET /api/inquiry/search
 */
router.get("/search", auth, searchInquiries);

/**
 * @route   POST /api/inquiry/create
 */
router.post("/create", auth, createInquiry);

/**
 * @route   PUT /api/inquiry/update/:ticketId
 */
router.put("/update/:ticketId", auth, updateInquiry);

/**
 * @route   DELETE /api/inquiry/delete/:ticketId
 */
router.delete("/delete/:ticketId", auth, deleteInquiry);

/**
 * @route   get /api/inquiry/issues
 */
router.get("/issues", auth, getIssues);

/**
 * @route   get /api/inquiry/issues
 */
router.get("/getOfficersByBU", auth, getOfficersByBU);

// 2. Changed module.exports to export default
export default router;
