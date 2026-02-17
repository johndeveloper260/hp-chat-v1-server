import express from "express";
import auth from "../middleware/auth.js";
import {
  getFolders,
  createFolder,
  deleteFolder,
  generateUploadUrl,
  confirmFileUpload,
  getFileViewUrl,
  deleteFile,
  getBreadcrumb,
} from "../controller/sharepointController.js";

const router = express.Router();

// ── Folders ──────────────────────────────────────────────────────────
router.get("/folders", auth, getFolders);
router.post("/folders", auth, createFolder);
router.delete("/folders/:id", auth, deleteFolder);

// ── Files (presigned-URL approach) ───────────────────────────────────
router.post("/files/generate-url", auth, generateUploadUrl);
router.post("/files/confirm", auth, confirmFileUpload);
router.get("/files/view/:id", auth, getFileViewUrl);
router.delete("/files/:id", auth, deleteFile);

// ── Breadcrumb ───────────────────────────────────────────────────────
router.get("/breadcrumb/:folderId", auth, getBreadcrumb);

export default router;
