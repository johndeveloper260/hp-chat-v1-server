import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

import {
  getSendingOrgDropdown,
  getVisaDropdown,
} from "../controller/sendingOrgController.js";

/**
 * @route   GET /sending-org/dropdown?country_origin=PH
 * @desc    Get sending organizations filtered by country code
 */
router.get("/dropdown", auth, getSendingOrgDropdown);

/**
 * @route   GET /visa-list/dropdown?lang=ja
 * @desc    Get visa types filtered by business unit and specific language
 */
router.get("/visa-type", auth, getVisaDropdown);

export default router;
