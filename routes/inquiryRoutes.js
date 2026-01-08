const express = require("express");
const router = express.Router();

// Middleware
const auth = require("../middleware/auth");

// Controller
const {
  searchInquiries,
  createInquiry,
  updateInquiry,
  deleteInquiry,
} = require("../controller/inquiryController");

/**
 * @route   GET /api/inquiry/search
 * @desc    Search/Get all inquiries with filters
 * @access  Private
 */
router.get("/search", auth, searchInquiries);

/**
 * @route   POST /api/inquiry/create
 * @desc    Create a new inquiry ticket
 * @access  Private
 */
router.post("/create", auth, createInquiry);

/**
 * @route   PUT /api/inquiry/update/:ticketId
 * @desc    Update an existing inquiry
 * @access  Private
 */
router.put("/update/:ticketId", auth, updateInquiry);

/**
 * @route   DELETE /api/inquiry/delete/:ticketId
 * @desc    Delete an inquiry ticket
 * @access  Private
 */
router.delete("/delete/:ticketId", auth, deleteInquiry);

module.exports = router;
