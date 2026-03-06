import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  generateUploadUrl,
  confirmFileUpload,
  getFileViewUrl,
  deleteFile,
  getBreadcrumb,
} from "../controller/sharepointController.js";

const router = express.Router();

// ── All authenticated users (read-only) ───────────────────────────────────────
router.get("/folders",              auth, getFolders);
router.get("/files/view/:id",       auth, getFileViewUrl);
router.get("/breadcrumb/:folderId", auth, getBreadcrumb);

// ── sharepoint_write ──────────────────────────────────────────────────────────
router.post("/folders",           auth, requireRole("sharepoint_write"), createFolder);
router.patch("/folders/:id",      auth, requireRole("sharepoint_write"), updateFolder);
router.delete("/folders/:id",     auth, requireRole("sharepoint_write"), deleteFolder);
router.post("/files/generate-url", auth, requireRole("sharepoint_write"), generateUploadUrl);
router.post("/files/confirm",      auth, requireRole("sharepoint_write"), confirmFileUpload);
router.delete("/files/:id",        auth, requireRole("sharepoint_write"), deleteFile);

export default router;
