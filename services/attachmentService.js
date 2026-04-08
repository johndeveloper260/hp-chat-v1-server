/**
 * Attachment Service
 *
 * Handles:
 *   - Presigned PUT URL generation (upload)
 *   - DB confirmation of uploads
 *   - Presigned GET URL generation (viewing)
 *   - BU-scoped delete (single, profile-picture, batch-by-relation)
 *   - Rename
 *   - Profile-picture → GetStream sync
 *
 * NOTE: The "upload" presigned URL (PutObjectCommand) lives here.
 *       The shared "download" presigned URL (GetObjectCommand) lives in utils/s3Client.js.
 */
import { StreamChat } from "stream-chat";
import { getSignedUrl }     from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand }  from "@aws-sdk/client-s3";
import env                  from "../config/env.js";
import { getS3Client, deleteFromS3, getPresignedUrl as getDownloadUrl } from "../utils/s3Client.js";
import { getS3Key }         from "../utils/getS3Key.js";
import { clearAvatarCache } from "./profileService.js";
import * as attachRepo      from "../repositories/attachmentRepository.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../errors/AppError.js";

// ── Stream singleton ──────────────────────────────────────────────────────────
let _streamClient = null;
const getStreamClient = () => {
  if (!_streamClient) {
    _streamClient = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamClient;
};

// ─── 1. Generate presigned PUT URL (upload) ───────────────────────────────────

export const generateUploadUrl = async (fileName, fileType, businessUnit, relationType, relationId) => {
  const s3Key = getS3Key(businessUnit, relationType, relationId, fileName);

  const command = new PutObjectCommand({
    Bucket: env.aws.bucket,
    Key: s3Key,
    ContentType: fileType,
  });

  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 300 });
  return { uploadUrl, s3Key, bucketName: env.aws.bucket };
};

// ─── 2. Create attachment DB record (confirm upload) ──────────────────────────

export const createAttachment = async ({
  relation_type, relation_id, s3_key, s3_bucket,
  display_name, file_type, userBU,
}) => {
  if (!relation_id) throw new ValidationError("missing_relation_id");

  const parentExists = await attachRepo.checkParentBU(relation_type, relation_id, userBU);
  if (parentExists === 0) throw new NotFoundError("record_not_found");

  const attachment = await attachRepo.insertSharedAttachment({
    relation_type, relation_id, s3_key, s3_bucket,
    display_name, file_type, business_unit: userBU,
  });

  // Sync profile pictures to GetStream (best-effort)
  if (relation_type === "profile") {
    clearAvatarCache(relation_id);
    try {
      await syncProfilePictureToStream(relation_id, s3_key, s3_bucket);
    } catch (err) {
      console.error("Stream sync failed but attachment saved:", err);
    }
  }

  return attachment;
};

// ─── 3. Sync profile picture URL to GetStream ─────────────────────────────────

/**
 * Generates a 24-hour signed GET URL and pushes it to GetStream as the user's image.
 * Re-exported for backward compatibility.
 */
export const syncProfilePictureToStream = async (userId, s3Key, s3Bucket) => {
  const profileImageUrl = env.aws.cloudfrontDomain
    ? `https://${env.aws.cloudfrontDomain}/${s3Key}`
    : await getDownloadUrl(s3Bucket, s3Key, 86400);
  await getStreamClient().partialUpdateUser({
    id: userId.toString(),
    set: { image: profileImageUrl },
  });
  return profileImageUrl;
};

// ─── 4. Generate presigned GET URL (viewing) ──────────────────────────────────

export const getViewingUrl = async (attachmentId, userBU) => {
  const attachment = await attachRepo.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError("record_not_found");

  const { relation_type, relation_id, s3_key, s3_bucket } = attachment;
  const parentExists = await attachRepo.checkParentBU(relation_type, relation_id, userBU);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  // Serve via CloudFront when configured — cached at the edge, reduces S3 egress.
  if ((relation_type === "announcements" || relation_type === "profile" || relation_type === "inquiries" || relation_type === "return_home") && env.aws.cloudfrontDomain) {
    return `https://${env.aws.cloudfrontDomain}/${s3_key}`;
  }

  return getDownloadUrl(s3_bucket, s3_key, 3600);
};

// ─── 5. Get all attachments for a relation ────────────────────────────────────

export const getAttachmentsByRelation = async (relationType, relationId, userBU) => {
  const parentExists = await attachRepo.checkParentBU(relationType, relationId, userBU);
  if (parentExists === 0) throw new NotFoundError("record_not_found");

  return attachRepo.findAttachmentsByRelation(relationType, relationId);
};

// ─── 6. Delete single attachment ──────────────────────────────────────────────

export const deleteAttachment = async (attachmentId, userBU) => {
  const attachment = await attachRepo.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError("record_not_found");

  const { s3_key, relation_type, relation_id } = attachment;
  const parentExists = await attachRepo.checkParentBU(relation_type, relation_id, userBU);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  await deleteFromS3(s3_key);
  await attachRepo.deleteAttachmentById(attachmentId);

  // Remove from Stream if this was a profile picture
  if (relation_type === "profile") {
    clearAvatarCache(relation_id);
    try {
      await getStreamClient().partialUpdateUser({
        id: relation_id.toString(),
        unset: ["image"],
      });
    } catch (err) {
      console.error("Stream sync failed during delete:", err);
    }
  }
};

// ─── 7. Delete profile picture by user ID ────────────────────────────────────

export const deleteProfilePicture = async (userId, userBU) => {
  const parentExists = await attachRepo.checkParentBU("profile", userId, userBU);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  const pic = await attachRepo.findProfilePicture(userId);
  if (!pic) throw new NotFoundError("record_not_found");

  await deleteFromS3(pic.s3_key);
  await attachRepo.deleteAttachmentById(pic.attachment_id);

  clearAvatarCache(userId);
  try {
    await getStreamClient().partialUpdateUser({
      id: userId.toString(),
      unset: ["image"],
    });
  } catch (err) {
    console.error("Stream sync failed during profile picture delete:", err);
  }

  return { attachment_id: pic.attachment_id };
};

// ─── 8. Batch delete all attachments for a relation ──────────────────────────

export const deleteAttachmentsByRelation = async (relationType, relationId, userBU) => {
  const parentExists = await attachRepo.checkParentBU(relationType, relationId, userBU);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  const rows = await attachRepo.findAttachmentKeysByRelation(relationType, relationId, userBU);
  if (rows.length === 0) throw new NotFoundError("record_not_found");

  await Promise.all(rows.map((r) => deleteFromS3(r.s3_key)));
  await attachRepo.deleteAttachmentsByRelation(relationType, relationId);

  if (relationType === "profile") {
    clearAvatarCache(relationId);
    try {
      await getStreamClient().partialUpdateUser({
        id: relationId.toString(),
        unset: ["image"],
      });
    } catch (err) {
      console.error("Stream sync failed during batch delete:", err);
    }
  }

  return { count: rows.length };
};

// ─── 9. Rename attachment ─────────────────────────────────────────────────────

export const renameAttachment = async (attachmentId, displayName, userBU) => {
  if (!displayName || displayName.trim() === "") {
    throw new ValidationError("display_name_required");
  }

  const exists = await attachRepo.checkAttachmentExists(attachmentId);
  if (exists === 0) throw new NotFoundError("record_not_found");

  const { rows, rowCount } = await attachRepo.updateAttachmentDisplayName(
    attachmentId, displayName.trim(), userBU,
  );
  if (rowCount === 0) throw new ForbiddenError("forbidden");

  return rows[0];
};
