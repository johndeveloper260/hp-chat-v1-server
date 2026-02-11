import express from "express";
import auth from "../middleware/auth.js";
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  toggleReaction,
  getCompaniesWithUsers,
  getBatchesByCompany,
  previewAudience,
  getReactions,
  getPosters,
  markAsSeen,
  getViewers,
} from "../controller/feedController.js";

const router = express.Router();

router.get("/getAnnouncements", auth, getAnnouncements);
router.post("/createAnnouncement", auth, createAnnouncement);
router.put("/updateAnnouncement/:rowId", auth, updateAnnouncement);
router.post("/:rowId/react", auth, toggleReaction);

// New routes
router.get("/companies-with-users", auth, getCompaniesWithUsers);
router.get("/batches/:companyId", auth, getBatchesByCompany);
router.post("/preview-audience", auth, previewAudience);
router.get("/reactions/:rowId", auth, getReactions);
router.get("/posters", auth, getPosters);
router.post("/:rowId/mark-seen", auth, markAsSeen);
router.get("/:rowId/viewers", auth, getViewers);

//Delete
router.delete("/deleteAnnouncement/:rowId", auth, deleteAnnouncement);

export default router;
