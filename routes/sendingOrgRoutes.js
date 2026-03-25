/**
 * Sending Org Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireOfficer, requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createSendingOrgSchema, updateSendingOrgSchema } from "../validators/sendingOrgValidator.js";
import {
  getSendingOrgDropdown,
  getVisaDropdown,
  getSendingOrgList,
  createSendingOrg,
  updateSendingOrg,
  deleteSendingOrg,
} from "../controller/sendingOrgController.js";

const router = express.Router();

// ── any officer — dropdowns used widely ───────────────────────────────────────
router.get("/dropdown",  auth, requireOfficer, getSendingOrgDropdown);
router.get("/visa-type", auth, requireOfficer, getVisaDropdown);

// ── sending_org_read ──────────────────────────────────────────────────────────
router.get("/list", auth, requireRole("sending_org_read"), getSendingOrgList);

// ── sending_org_write ─────────────────────────────────────────────────────────
router.post(  "/create",         auth, requireRole("sending_org_write"), validate(createSendingOrgSchema), createSendingOrg);
router.put(   "/update/:code",   auth, requireRole("sending_org_write"), validate(updateSendingOrgSchema), updateSendingOrg);
router.delete("/delete/:code",   auth, requireRole("sending_org_write"),                                   deleteSendingOrg);

export default router;
