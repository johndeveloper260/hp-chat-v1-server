/**
 * Attachment Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/attachmentService.js.
 *
 * Backward-compatibility re-exports:
 *   deleteFromS3             → utils/s3Client       (was imported from this file by old controllers)
 *   syncProfilePictureToStream → services/attachmentService
 */
import * as attachService from "../services/attachmentService.js";

// ─── 1. Generate presigned PUT URL (upload) ───────────────────────────────────

export const generateUploadUrl = async (req, res, next) => {
  try {
    const { fileName, fileType, relationType, relationId } = req.body;
    const businessUnit = req.user.business_unit;

    if (!relationType || !relationId) {
      return res.status(400).json({ error: "relationType and relationId are required" });
    }

    const data = await attachService.generateUploadUrl(
      fileName, fileType, businessUnit, relationType, relationId,
    );
    res.json(data);
  } catch (err) {
    next(err);
  }
};

// Alias: old attachmentRoutes called this name directly as a function
export const getPresignedUrl = generateUploadUrl;

// ─── 2. Confirm upload (save DB record) ───────────────────────────────────────

export const createAttachment = async (req, res, next) => {
  try {
    const { relation_type, relation_id, s3_key, s3_bucket, display_name, file_type } = req.body;
    const userBU = req.user.business_unit;

    const attachment = await attachService.createAttachment({
      relation_type, relation_id, s3_key, s3_bucket,
      display_name, file_type, userBU, uploaderUserId: req.user.id,
    });
    res.json(attachment);
  } catch (err) {
    next(err);
  }
};

// ─── 3. Generate presigned GET URL (viewing) ──────────────────────────────────

export const getViewingUrl = async (req, res, next) => {
  try {
    const url = await attachService.getViewingUrl(req.params.id, req.user.business_unit, req.user.id);
    res.json({ url });
  } catch (err) {
    next(err);
  }
};

// ─── 4. Get all attachments for a relation ────────────────────────────────────

export const getAttachmentsByRelation = async (req, res, next) => {
  try {
    const { relationType, relationId } = req.params;
    const attachments = await attachService.getAttachmentsByRelation(
      relationType, relationId, req.user.business_unit, req.user.id, req.user.userType,
    );
    res.json({ attachments });
  } catch (err) {
    next(err);
  }
};

// ─── 5. Delete single attachment ──────────────────────────────────────────────

export const deleteAttachment = async (req, res, next) => {
  try {
    await attachService.deleteAttachment(req.params.id, req.user.business_unit, req.user.id);
    res.json({ message: "Attachment deleted successfully from S3 and DB" });
  } catch (err) {
    next(err);
  }
};

// ─── 6. Delete profile picture by user ID ────────────────────────────────────

export const deleteProfilePicture = async (req, res, next) => {
  try {
    const result = await attachService.deleteProfilePicture(
      req.params.userId, req.user.business_unit,
    );
    res.json({ message: "Profile picture deleted successfully", ...result });
  } catch (err) {
    next(err);
  }
};

// ─── 7. Batch delete all attachments for a relation ──────────────────────────

export const deleteAttachmentsByRelation = async (req, res, next) => {
  try {
    const { relationType, relationId } = req.params;
    const { count } = await attachService.deleteAttachmentsByRelation(
      relationType, relationId, req.user.business_unit, req.user.id,
    );
    res.json({ message: `Successfully deleted ${count} attachment(s)`, count });
  } catch (err) {
    next(err);
  }
};

// ─── 8. Proxy-stream attachment (avoids browser CORS on S3 presigned URLs) ────

export const proxyAttachment = async (req, res, next) => {
  try {
    const { body, contentType, contentLength, displayName } =
      await attachService.streamAttachment(req.params.id, req.user.business_unit, req.user.id, req.user.userType);

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(displayName)}"`,
    );
    if (contentLength) res.setHeader("Content-Length", contentLength);

    body.pipe(res);
  } catch (err) {
    next(err);
  }
};

// ─── 9. Rename attachment ─────────────────────────────────────────────────────

export const renameAttachment = async (req, res, next) => {
  try {
    const data = await attachService.renameAttachment(
      req.params.id, req.body.display_name, req.user.business_unit,
    );
    res.status(200).json({ message: "Attachment renamed successfully", data });
  } catch (err) {
    next(err);
  }
};

// ─── Backward-compatibility re-exports ───────────────────────────────────────
// Other controllers previously imported these directly from this file.
// New services import from their canonical locations, but these re-exports
// ensure any remaining consumers continue to work without changes.
export { deleteFromS3 }              from "../utils/s3Client.js";
export { syncProfilePictureToStream } from "../services/attachmentService.js";
