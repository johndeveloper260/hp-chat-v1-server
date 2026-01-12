import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Convert require to a named import and add the .js extension
import {
  updateWorkVisa,
  getUserLegalProfile,
  getUserProfile,
  updateUserProfile,
} from "../controller/profileController.js";

// Private //

// Visa
router.get(`/user-legal-info/:userId`, auth, getUserLegalProfile);
router.put(`/visa-info/:userId`, auth, updateWorkVisa);

// Profile
router.get("/personal-info/:userId", auth, getUserProfile);
router.put("/personal-info/:userId", auth, updateUserProfile);

// 2. Change module.exports to export default
export default router;
