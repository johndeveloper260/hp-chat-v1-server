const express = require("express");
const router = express.Router();

// Middleware
const auth = require("../middleware/auth");

// Controller
const {
  getCompanies,
  getCompanyDropdown,
  createCompany,
  updateCompany,
  deleteCompany,
} = require("../controller/companyController");

/**
 * @route   GET /api/company/list
 * @desc    Get all company details (Full table)
 * @access  Private
 */
router.get("/list", auth, getCompanies);

/**
 * @route   GET /api/company/dropdown
 * @desc    Get simple list for Dropdown/Pickers (ID and English Name)
 * @access  Private
 */
router.get("/dropdown", auth, getCompanyDropdown);

/**
 * @route   POST /api/company/create
 * @desc    Create a new company (Sets last_updated_by automatically)
 * @access  Private
 */
router.post("/create", auth, createCompany);

/**
 * @route   PUT /api/company/update/:id
 * @desc    Update company details
 * @access  Private
 */
router.put("/update/:id", auth, updateCompany);

/**
 * @route   DELETE /api/company/delete/:id
 * @desc    Remove a company
 * @access  Private
 */
router.delete("/delete/:id", auth, deleteCompany);

module.exports = router;
