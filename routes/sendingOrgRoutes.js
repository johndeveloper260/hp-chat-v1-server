import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

import { getSendingOrgDropdown } from "../controller/sendingOrgController.js";

/**
 * @route   GET /sending-org/dropdown?country_origin=PH
 * @desc    Get sending organizations filtered by country code
 */
router.get("/dropdown", auth, getSendingOrgDropdown);

export default router;
