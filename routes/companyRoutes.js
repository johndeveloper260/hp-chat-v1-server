import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Convert require to a named import and add the .js extension
import {
  getCompanies,
  getCompanyDropdown,
  createCompany,
  updateCompany,
  deleteCompany,
} from "../controller/companyController.js";

/**
 * @route   GET /api/company/list
 */
router.get("/list", auth, getCompanies);

/**
 * @route   GET /api/company/dropdown
 */
router.get("/dropdown", auth, getCompanyDropdown);

/**
 * @route   POST /api/company/create
 */
router.post("/create", auth, createCompany);

/**
 * @route   PUT /api/company/update/:id
 */
router.put("/update/:id", auth, updateCompany);

/**
 * @route   DELETE /api/company/delete/:id
 */
router.delete("/delete/:id", auth, deleteCompany);

// 2. Change module.exports to export default
export default router;
