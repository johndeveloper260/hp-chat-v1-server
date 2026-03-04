import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Convert require to a named import and add the .js extension
import {
  searchUsers,
  updateWorkVisa,
  getUserLegalProfile,
  getUserProfile,
  updateUserProfile,
  updateUserLanguage,
  toggleUserActive,
  getUserAvatar,
} from "../controller/profileController.js";

// Public //

// Avatar proxy — no auth, permanent URL safe to store in Stream Chat
router.get("/avatar/:userId", getUserAvatar);

// Private //

// Visa
router.get(`/user-legal-info/:userId`, auth, getUserLegalProfile);
router.put(`/visa-info/:userId`, auth, updateWorkVisa);

// Profile
router.get("/search-users", auth, searchUsers);

router.get("/personal-info/:userId", auth, getUserProfile);
router.put("/personal-info/:userId", auth, updateUserProfile);

// Account
router.patch("/update-language", auth, updateUserLanguage);

// User Management (Officer/Admin only)
router.patch("/toggle-active/:userId", auth, toggleUserActive);

// 2. Change module.exports to export default
export default router;
