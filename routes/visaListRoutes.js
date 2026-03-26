/**
 * Visa List Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createVisaListSchema, updateVisaListSchema } from "../validators/visaListValidator.js";
import {
  getVisaListAll,
  createVisaList,
  updateVisaList,
  deleteVisaList,
} from "../controller/visaListController.js";

const router = express.Router();

// ── visa_read ──────────────────────────────────────────────────────────────────
router.get("/list", auth, requireRole("visa_read"), getVisaListAll);

// ── visa_write ─────────────────────────────────────────────────────────────────
router.post(  "/create",       auth, requireRole("visa_write"), validate(createVisaListSchema), createVisaList);
router.put(   "/update/:id",   auth, requireRole("visa_write"), validate(updateVisaListSchema), updateVisaList);
router.delete("/delete/:id",   auth, requireRole("visa_write"),                                 deleteVisaList);

export default router;
