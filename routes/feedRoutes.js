/**
 * Feed (Announcement) Routes
 */
import express from "express";
import auth               from "../middleware/auth.js";
import { requireRole }    from "../middleware/requireRole.js";
import { validate }       from "../middleware/validate.js";
import {
  createAnnouncementSchema,
  updateAnnouncementSchema,
  toggleReactionSchema,
  previewAudienceSchema,
} from "../validators/feedValidator.js";
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  toggleReaction,
  toggleFavorite,
  getCompaniesWithUsers,
  getBatchesByCompany,
  previewAudience,
  getReactions,
  getPosters,
  markAsSeen,
  getViewers,
  deleteAnnouncement,
} from "../controller/feedController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
router.get("/getAnnouncements",  auth, getAnnouncements);
router.post("/:rowId/react",     auth, validate(toggleReactionSchema), toggleReaction);
router.post("/:rowId/favorite",  auth, toggleFavorite);
router.get("/reactions/:rowId",  auth, getReactions);
router.post("/:rowId/mark-seen", auth, markAsSeen);

// ── announcements_read (or announcements_write) ───────────────────────────────
router.get("/:rowId/viewers",       auth, requireRole("announcements_read"), getViewers);
router.get("/companies-with-users", auth, requireRole("announcements_read"), getCompaniesWithUsers);
router.get("/batches/:companyId",   auth, requireRole("announcements_read"), getBatchesByCompany);
router.post("/preview-audience",    auth, requireRole("announcements_read"), validate(previewAudienceSchema), previewAudience);
router.get("/posters",              auth, requireRole("announcements_read"), getPosters);

// ── announcements_write ───────────────────────────────────────────────────────
router.post("/createAnnouncement",          auth, requireRole("announcements_write"), validate(createAnnouncementSchema), createAnnouncement);
router.put("/updateAnnouncement/:rowId",    auth, requireRole("announcements_write"), validate(updateAnnouncementSchema), updateAnnouncement);
router.delete("/deleteAnnouncement/:rowId", auth, requireRole("announcements_write"), deleteAnnouncement);

export default router;
