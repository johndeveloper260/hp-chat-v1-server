/**
 * Profile Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate }           from "../middleware/validate.js";
import { updateLanguageSchema } from "../validators/profileValidator.js";
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

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────────
// Avatar proxy — no auth, permanent URL safe to store in Stream Chat
router.get("/avatar/:userId", getUserAvatar);

// ── All authenticated users (own profile) ─────────────────────────────────────
router.get("/personal-info/:userId",   auth, getUserProfile);
router.put("/personal-info/:userId",   auth, updateUserProfile);
router.get("/user-legal-info/:userId", auth, getUserLegalProfile);
router.put("/visa-info/:userId",       auth, updateWorkVisa);
router.patch("/update-language",       auth, validate(updateLanguageSchema), updateUserLanguage);

// ── profile_read (or profile_write) ──────────────────────────────────────────
router.get("/search-users", auth, requireRole("profile_read"), searchUsers);

// ── profile_write ─────────────────────────────────────────────────────────────
router.patch("/toggle-active/:userId", auth, requireRole("profile_write"), toggleUserActive);

export default router;
