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
import { getSignedUrl }                    from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import env                  from "../config/env.js";
import { getS3Client, deleteFromS3, getPresignedUrl as getDownloadUrl } from "../utils/s3Client.js";
import { getS3Key }         from "../utils/getS3Key.js";
import { clearAvatarCache } from "./profileService.js";
import * as attachRepo      from "../repositories/attachmentRepository.js";
import * as spRepo          from "../repositories/sharepointRepository.js";
import * as commentsRepo    from "../repositories/commentsRepository.js";
import { createNotification } from "./notificationService.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../errors/AppError.js";

// ── Stream singleton ──────────────────────────────────────────────────────────
let _streamClient = null;
const getStreamClient = () => {
  if (!_streamClient) {
    _streamClient = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamClient;
};

const CHAT_RELATION_TYPE = "chat_message";

const normalizeChannelId = (channelId) => {
  const value = String(channelId || "");
  return value.startsWith("messaging:") ? value.slice("messaging:".length) : value;
};

const assertChatChannelMember = async (channelId, userId) => {
  if (!channelId || !userId) throw new ForbiddenError("forbidden");
  const channel = getStreamClient().channel("messaging", normalizeChannelId(channelId));
  const { members = [] } = await channel.queryMembers(
    { user_id: { $eq: String(userId) } },
    {},
    { limit: 1 },
  );
  if (members.length === 0) throw new ForbiddenError("forbidden");
  return 1;
};

const checkRelationAccess = async (relationType, relationId, userBU, userId = null) => {
  if (relationType === CHAT_RELATION_TYPE) {
    return assertChatChannelMember(relationId, userId);
  }
  return attachRepo.checkParentBU(relationType, relationId, userBU, null, userId);
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
  display_name, file_type, userBU, uploaderUserId,
}) => {
  if (!relation_id) throw new ValidationError("missing_relation_id");

  const parentExists = await checkRelationAccess(relation_type, relation_id, userBU, uploaderUserId);
  if (parentExists === 0) throw new NotFoundError("record_not_found");

  const attachment = await attachRepo.insertSharedAttachment({
    relation_type, relation_id, s3_key, s3_bucket,
    display_name, file_type, business_unit: userBU, created_by: uploaderUserId ?? null,
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

  // Notify task team members when a file is uploaded to a team task (best-effort)
  if (relation_type === "task" && uploaderUserId) {
    try {
      const [recipients, taskRowId] = await Promise.all([
        commentsRepo.findTaskRecipientsByUUID(relation_id, uploaderUserId),
        commentsRepo.findTaskRowIdByUUID(relation_id),
      ]);
      if (recipients.length > 0) {
        const filePreview = display_name.length > 50
          ? `${display_name.substring(0, 50)}...`
          : display_name;
        await Promise.all(
          recipients.map((recipientId) =>
            createNotification({
              userId: recipientId,
              titleKey:   "file_on_task",
              bodyKey:    "file_body",
              bodyParams: { file: filePreview },
              data: { type: "task", rowId: taskRowId, relationId: relation_id, screen: "Tasks", params: { taskId: relation_id } },
            }),
          ),
        );
      }
    } catch (err) {
      console.error("Task file notification failed:", err);
    }
  }

  if (relation_type === "subtask" && uploaderUserId) {
    try {
      const [recipients, taskRowId] = await Promise.all([
        commentsRepo.findSubtaskRecipientsByUUID(relation_id, uploaderUserId),
        commentsRepo.findTaskRowIdByUUID(relation_id),
      ]);
      if (recipients.length > 0) {
        const filePreview = display_name.length > 50
          ? `${display_name.substring(0, 50)}...`
          : display_name;
        await Promise.all(
          recipients.map((recipientId) =>
            createNotification({
              userId: recipientId,
              titleKey:   "file_on_task",
              bodyKey:    "file_body",
              bodyParams: { file: filePreview },
              data: { type: "subtask", rowId: taskRowId, relationId: relation_id, screen: "MyTasks", params: { taskId: relation_id } },
            }),
          ),
        );
      }
    } catch (err) {
      console.error("Subtask file notification failed:", err);
    }
  }

  return attachment;
};

// ─── 2b. Link a SharePoint file into a relation's attachments ─────────────────

// SharePoint file objects live under this S3 prefix (see sharepointService
// generateUploadUrl). A "link from Files" attachment shares the file's exact
// s3_key, so this prefix marks an attachment as a reference whose underlying
// S3 object is OWNED by /files — it must never be deleted on the attachment side.
export const SHAREPOINT_KEY_PREFIX = "sharepoint/";

const isSharepointOwned = (s3Key) =>
  typeof s3Key === "string" && s3Key.startsWith(SHAREPOINT_KEY_PREFIX);

/**
 * References an existing SharePoint file from a relation (e.g. an announcement)
 * by inserting a shared_attachments record that points at the file's SAME
 * S3 object — no copy, no storage duplication. The SharePoint side guards
 * against deleting a file while any announcement still references it
 * (see sharepointService.deleteFile / deleteFolder).
 */
export const copyFromSharepointFile = async ({
  fileId, relation_type, relation_id, userBU, userId,
}) => {
  if (!fileId || !relation_type || !relation_id) {
    throw new ValidationError("missing_copy_params");
  }

  // SharePoint file must exist within the caller's business unit
  const file = await spRepo.findFileWithFolderBU(fileId, userBU);
  if (!file) throw new NotFoundError("record_not_found");

  // Target record (e.g. the announcement) must exist within the caller's BU
  const parentExists = await checkRelationAccess(relation_type, relation_id, userBU, userId);
  if (parentExists === 0) throw new NotFoundError("record_not_found");

  return attachRepo.insertSharedAttachment({
    relation_type,
    relation_id,
    s3_key: file.s3_key,                         // reference the SAME object
    s3_bucket: file.s3_bucket || env.aws.bucket,
    display_name: file.display_name,
    file_type: file.file_type,
    business_unit: userBU,
    created_by: userId ?? null,
  });
};

export const linkSharepointFileToChat = async ({
  fileId, channelId, userBU, userId,
}) => {
  if (!fileId || !channelId) {
    throw new ValidationError("missing_chat_link_params");
  }

  const file = await spRepo.findFileWithFolderBU(fileId, userBU);
  if (!file) throw new NotFoundError("record_not_found");

  await assertChatChannelMember(channelId, userId);

  return attachRepo.insertSharedAttachment({
    relation_type: CHAT_RELATION_TYPE,
    relation_id: normalizeChannelId(channelId),
    s3_key: file.s3_key,
    s3_bucket: file.s3_bucket || env.aws.bucket,
    display_name: file.display_name,
    file_type: file.file_type,
    business_unit: userBU,
    created_by: userId ?? null,
  });
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

export const getViewingUrl = async (attachmentId, userBU, userId = null) => {
  const attachment = await attachRepo.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError("record_not_found");

  const { relation_type, relation_id, s3_key, s3_bucket } = attachment;
  const parentExists = await checkRelationAccess(relation_type, relation_id, userBU, userId);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  // Serve via CloudFront when configured — cached at the edge, reduces S3 egress.
  if ((relation_type === "announcements" || relation_type === "profile" || relation_type === "inquiries" || relation_type === "return_home" || relation_type === "task" || relation_type === "subtask" || relation_type === "app_support" || relation_type === CHAT_RELATION_TYPE) && env.aws.cloudfrontDomain) {
    return `https://${env.aws.cloudfrontDomain}/${s3_key}`;
  }

  return getDownloadUrl(s3_bucket, s3_key, 3600);
};

// ─── 5. Get all attachments for a relation ────────────────────────────────────

const isPrivileged = (userType) =>
  ["OFFICER", "ADMIN"].includes((userType || "").toUpperCase());

export const getAttachmentsByRelation = async (relationType, relationId, userBU, userId = null, userType = null) => {
  // Privileged users (OFFICER/ADMIN) viewing subtask attachments need to see ALL
  // attachments from every assignee, not just their own. The standard checkParentBU
  // for "subtask" enforces an assignee membership check which admins would fail.
  if (relationType === "subtask" && isPrivileged(userType)) {
    const { rowCount } = await attachRepo.checkSubtaskExistsBU(relationId, userBU);
    if (!rowCount) throw new NotFoundError("record_not_found");
    // Pass null for userId so no created_by filter is applied — return all attachments.
    return attachRepo.findAttachmentsByRelation(relationType, relationId, null, null);
  }

  const parentExists = await checkRelationAccess(relationType, relationId, userBU, userId);
  if (parentExists === 0) throw new NotFoundError("record_not_found");

  return attachRepo.findAttachmentsByRelation(relationType, relationId, null, userId);
};

// ─── 6. Delete single attachment ──────────────────────────────────────────────

export const deleteAttachment = async (attachmentId, userBU, userId = null) => {
  const attachment = await attachRepo.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError("record_not_found");

  const { s3_key, relation_type, relation_id } = attachment;
  const parentExists = await checkRelationAccess(relation_type, relation_id, userBU, userId);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  // Linked SharePoint files share the original S3 object — only drop the DB row,
  // never the object (the file in /files still owns it).
  if (!isSharepointOwned(s3_key)) await deleteFromS3(s3_key);
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

export const deleteAttachmentsByRelation = async (relationType, relationId, userBU, userId = null) => {
  const parentExists = await checkRelationAccess(relationType, relationId, userBU, userId);
  if (parentExists === 0) throw new ForbiddenError("forbidden");

  const rows = await attachRepo.findAttachmentKeysByRelation(relationType, relationId, userBU);
  if (rows.length === 0) throw new NotFoundError("record_not_found");

  // Skip S3 deletes for linked SharePoint files — those objects belong to /files.
  await Promise.all(
    rows
      .filter((r) => !isSharepointOwned(r.s3_key))
      .map((r) => deleteFromS3(r.s3_key)),
  );
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

// ─── 9. Proxy-stream attachment bytes (for cross-origin download) ─────────────

/**
 * Validates ownership then returns the S3 object stream + metadata so the
 * controller can pipe it straight to the HTTP response.
 * The caller is responsible for setting Content-Type and piping Body.
 */
export const streamAttachment = async (attachmentId, userBU, userId = null, userType = null) => {
  const attachment = await attachRepo.findAttachmentById(attachmentId);
  if (!attachment) throw new NotFoundError("record_not_found");

  const { relation_type, relation_id, s3_key, s3_bucket } = attachment;

  // Privileged users (OFFICER/ADMIN) can download any attachment in their BU,
  // including subtask attachments uploaded by mobile workers they aren't assigned to.
  if (relation_type === "subtask" && isPrivileged(userType)) {
    const { rowCount } = await attachRepo.checkSubtaskExistsBU(relation_id, userBU);
    if (!rowCount) throw new ForbiddenError("forbidden");
  } else {
    const parentExists = await checkRelationAccess(relation_type, relation_id, userBU, userId);
    if (parentExists === 0) throw new ForbiddenError("forbidden");
  }

  const command = new GetObjectCommand({ Bucket: s3_bucket || env.aws.bucket, Key: s3_key });
  const s3Resp = await getS3Client().send(command);

  return {
    body: s3Resp.Body,                              // Node.js Readable stream
    contentType: attachment.file_type || s3Resp.ContentType || "application/octet-stream",
    contentLength: s3Resp.ContentLength,
    displayName: attachment.display_name,
  };
};

// ─── 10. Rename attachment ─────────────────────────────────────────────────────

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
