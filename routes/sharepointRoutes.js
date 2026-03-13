/**
 * Sharepoint Routes
 */
import express from "express";
import auth               from "../middleware/auth.js";
import { requireRole }    from "../middleware/requireRole.js";
import { validate }       from "../middleware/validate.js";
import {
  createFolderSchema,
  updateFolderSchema,
  updateFileSchema,
  generateUploadUrlSchema,
  confirmFileUploadSchema,
} from "../validators/sharepointValidator.js";
import {
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  generateUploadUrl,
  confirmFileUpload,
  getFileViewUrl,
  updateFile,
  deleteFile,
  getBreadcrumb,
  getStorageQuota,
} from "../controller/sharepointController.js";

const router = express.Router();

// ── All authenticated users (read-only) ───────────────────────────────────────
router.get("/folders",              auth, getFolders);
router.get("/files/view/:id",       auth, getFileViewUrl);
router.get("/breadcrumb/:folderId", auth, getBreadcrumb);
router.get("/storage-quota",        auth, getStorageQuota);

// ── sharepoint_write ──────────────────────────────────────────────────────────
router.post("/folders",            auth, requireRole("sharepoint_write"), validate(createFolderSchema),      createFolder);
router.patch("/folders/:id",       auth, requireRole("sharepoint_write"), validate(updateFolderSchema),      updateFolder);
router.delete("/folders/:id",      auth, requireRole("sharepoint_write"),                                    deleteFolder);
router.post("/files/generate-url", auth, requireRole("sharepoint_write"), validate(generateUploadUrlSchema), generateUploadUrl);
router.post("/files/confirm",      auth, requireRole("sharepoint_write"), validate(confirmFileUploadSchema),  confirmFileUpload);
router.patch("/files/:id",         auth, requireRole("sharepoint_write"), validate(updateFileSchema),         updateFile);
router.delete("/files/:id",        auth, requireRole("sharepoint_write"),                                    deleteFile);

export default router;
