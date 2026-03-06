import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getCompanies,
  getCompanyDropdown,
  createCompany,
  updateCompany,
  deleteCompany,
  getEmployeesByCompany,
} from "../controller/companyController.js";

const router = express.Router();

// ── company_read (or company_write) ──────────────────────────────────────────
router.get("/list",                   auth, requireRole("company_read"), getCompanies);
router.get("/dropdown",               auth, requireRole("company_read"), getCompanyDropdown);
router.get("/:companyId/employees",   auth, requireRole("company_read"), getEmployeesByCompany);

// ── company_write ─────────────────────────────────────────────────────────────
router.post("/create",        auth, requireRole("company_write"), createCompany);
router.put("/update/:id",     auth, requireRole("company_write"), updateCompany);
router.delete("/delete/:id",  auth, requireRole("company_write"), deleteCompany);

export default router;
