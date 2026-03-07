/**
 * Sending Org Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { getSendingOrgDropdown, getVisaDropdown } from "../controller/sendingOrgController.js";

const router = express.Router();

router.get("/dropdown",  auth, getSendingOrgDropdown);
router.get("/visa-type", auth, getVisaDropdown);

export default router;
