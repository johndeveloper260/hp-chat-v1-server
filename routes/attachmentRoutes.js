/**
 * Attachment Routes
 */
import express from "express";
import auth               from "../middleware/auth.js";
import { validate }       from "../middleware/validate.js";
import {
  generateUrlSchema,
  createAttachmentSchema,
  renameAttachmentSchema,
} from "../validators/attachmentValidator.js";
import {
  generateUploadUrl,
  createAttachment,
  getViewingUrl,
  proxyAttachment,
  getAttachmentsByRelation,
  deleteAttachment,
  deleteProfilePicture,
  deleteAttachmentsByRelation,
  renameAttachment,
} from "../controller/attachmentController.js";

const router = express.Router();

// ── 1. Generate presigned PUT URL for direct S3 upload ────────────────────────
router.post("/generate-url", auth, validate(generateUrlSchema), generateUploadUrl);

// ── 2. Confirm upload (save DB record, sync profile pics to Stream) ────────────
router.post("/confirm", auth, validate(createAttachmentSchema), createAttachment);

// ── 3. View single attachment (returns 1-hour signed GET URL) ─────────────────
router.get("/view/:id", auth, getViewingUrl);

// ── 3b. Proxy-stream attachment bytes (avoids S3 CORS for in-browser fetch) ───
router.get("/proxy/:id", auth, proxyAttachment);

// ── 4. Get all attachments for a relation ─────────────────────────────────────
router.get("/:relationType/:relationId", auth, getAttachmentsByRelation);

// ── 5. Delete single attachment (removes from S3 + Stream for profile pics) ───
router.delete("/:id", auth, deleteAttachment);

// ── 6. Delete profile picture by user ID (specialized endpoint) ───────────────
router.delete("/profile/:userId", auth, deleteProfilePicture);

// ── 7. Batch delete all attachments for a relation ────────────────────────────
router.delete("/relation/:relationType/:relationId", auth, deleteAttachmentsByRelation);

// ── 8. Rename attachment ──────────────────────────────────────────────────────
router.put("/:id/rename", auth, validate(renameAttachmentSchema), renameAttachment);

export default router;
