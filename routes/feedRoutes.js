import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Convert require to a named import and add the .js extension
import {
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
} from "../controller/feedController.js";

// Private
router.post(`/createAnnouncement`, auth, createAnnouncement);
router.get(`/getAnnouncements`, auth, getAnnouncements);
router.put(`/updateAnnouncement/:rowId`, auth, updateAnnouncement);

// 2. Change module.exports to export default
export default router;
