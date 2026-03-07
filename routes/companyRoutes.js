/**
 * Company Routes
 *
 * Mutation endpoints are guarded by Zod validate() middleware.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireOfficer, requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createCompanySchema, updateCompanySchema } from "../validators/companyValidator.js";
import {
  getCompanies,
  getCompanyDropdown,
  createCompany,
  updateCompany,
  deleteCompany,
  getEmployeesByCompany,
} from "../controller/companyController.js";

const router = express.Router();

// ── any officer — used widely (dropdowns, audience targeting, etc.) ───────────
router.get("/dropdown",             auth, requireOfficer,            getCompanyDropdown);
router.get("/:companyId/employees", auth, requireOfficer,            getEmployeesByCompany);

// ── company_read ──────────────────────────────────────────────────────────────
router.get("/list",                 auth, requireRole("company_read"), getCompanies);

// ── company_write ─────────────────────────────────────────────────────────────
router.post(  "/create",      auth, requireRole("company_write"), validate(createCompanySchema), createCompany);
router.put(   "/update/:id",  auth, requireRole("company_write"), validate(updateCompanySchema), updateCompany);
router.delete("/delete/:id",  auth, requireRole("company_write"),                                deleteCompany);

export default router;
