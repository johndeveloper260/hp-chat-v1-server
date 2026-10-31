/**
 * Sharepoint Service
 *
 * Business logic for v4.sharepoint_folders and v4.sharepoint_files.
 * Replaces the inline S3 client in the old sharepointController with
 * the shared getS3Client() singleton from utils/s3Client.
 */
import { getPool }                         from "../config/getPool.js";
import env                                 from "../config/env.js";
import { getS3Client, deleteFromS3, getPresignedUrl } from "../utils/s3Client.js";
import { signFileUrl }                     from "../utils/cloudfrontSigner.js";
import { getSignedUrl }                    from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand }                from "@aws-sdk/client-s3";
import * as spRepo                         from "../repositories/sharepointRepository.js";
import * as attachRepo                     from "../repositories/attachmentRepository.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../errors/AppError.js";

const OFFICER_TYPES = ["officer", "admin"];
const isOfficer = (userType) => OFFICER_TYPES.includes(userType?.toLowerCase());

// ─── Access ───────────────────────────────────────────────────────────────────

/**
 * Non-officers may only reach a folder whose ROOT folder lists their company.
 * Checked on every ID-based entry point, because "Copy link" URLs
 * (/files/<folderId>?file=<fileId>) jump straight past the root listing.
 * Officers/admins keep full access within their BU — a no-op for them, the
 * callers' own BU checks still apply.
 * 404 when the folder is missing or in another BU, 403 when it's out of scope.
 */
export const assertFolderAccess = async ({ folderId, userType, userCompany, businessUnit }) => {
  if (isOfficer(userType)) return;

  const { exists, allowed } = await spRepo.findFolderCompanyAccess(folderId, businessUnit, userCompany);
  if (!exists) throw new NotFoundError("record_not_found");
  if (!allowed) throw new ForbiddenError("folder_access_denied", "api_errors.files.access_denied");
};

/** Loads a file within the BU and applies assertFolderAccess to its folder. */
export const findAccessibleFile = async ({ fileId, userType, userCompany, businessUnit }) => {
  const file = await spRepo.findFileWithFolderBU(fileId, businessUnit);
  if (!file) throw new NotFoundError("record_not_found");

  await assertFolderAccess({ folderId: file.folder_id, userType, userCompany, businessUnit });
  return file;
};

// ─── Folders ──────────────────────────────────────────────────────────────────

/**
 * Returns { folders, files } for the given parent folder.
 * Officers see all root folders; trainees see only company-scoped root folders.
 * Trainees opening a sub-folder by ID are checked against its root's companies.
 */
export const getFolders = async ({ userType, userCompany, businessUnit, parent_id }) => {
  if (parent_id) {
    await assertFolderAccess({ folderId: parent_id, userType, userCompany, businessUnit });
  }

  let folders;

  if (isOfficer(userType)) {
    folders = parent_id
      ? await spRepo.findSubFolders(parent_id, businessUnit)
      : await spRepo.findRootFoldersOfficer(businessUnit);
  } else {
    folders = parent_id
      ? await spRepo.findSubFolders(parent_id, businessUnit)
      : await spRepo.findRootFoldersForCompany(businessUnit, userCompany);
  }

  const files = parent_id ? await spRepo.findFilesInFolder(parent_id) : [];
  return { folders, files };
};

export const createFolder = async ({ name, parent_id, company_ids, userId, userType, userCompany, businessUnit }) => {
  if (!isOfficer(userType) && !parent_id) {
    throw new ForbiddenError("officer_only_create", "api_errors.files.officer_only_create");
  }
  if (!name || !name.trim()) {
    throw new ValidationError("folder_name_required", "api_errors.files.folder_name_required");
  }
  if (parent_id) {
    await assertFolderAccess({ folderId: parent_id, userType, userCompany, businessUnit });
  }

  return spRepo.insertFolder({ name, parent_id, userId, company_ids, business_unit: businessUnit });
};

export const updateFolder = async ({ id, name, company_ids, userType, businessUnit }) => {
  if (!isOfficer(userType)) {
    throw new ForbiddenError("officer_only_update", "api_errors.files.officer_only_update");
  }
  if (!name?.trim() && !company_ids) {
    throw new ValidationError("nothing_to_update");
  }

  const existing = await spRepo.findFolderById(id, businessUnit);
  if (!existing) throw new NotFoundError("record_not_found");

  return spRepo.updateFolder(id, businessUnit, { name, company_ids });
};

/**
 * Recursively deletes a folder tree: collects all descendant IDs via CTE,
 * best-effort-deletes S3 objects, then purges DB rows in a transaction.
 */
export const deleteFolder = async ({ id, userType, businessUnit }) => {
  if (!isOfficer(userType)) {
    throw new ForbiddenError("officer_only_delete", "api_errors.files.officer_only_delete");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const folderIds = await spRepo.findDescendantFolderIds(id, businessUnit, client);
    if (folderIds.length === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("record_not_found");
    }

    const fileRows = await spRepo.findFileKeysByFolderIds(folderIds, client);

    // Cascade: remove any announcement/chat attachment rows that link to a file
    // in this tree (they share the file's exact s3_key), so they no longer point
    // at a now-deleted S3 object. The frontend warns the officer first.
    await attachRepo.deleteAttachmentsByS3Keys(
      fileRows.map((f) => f.s3_key),
      client,
    );

    // Best-effort S3 deletes — a single file failure must not abort the whole tree
    await Promise.all(
      fileRows.map((f) =>
        deleteFromS3(f.s3_key).catch((err) =>
          console.error("S3 delete error:", f.s3_key, err),
        ),
      ),
    );

    await spRepo.deleteFilesByFolderIds(folderIds, client);
    await spRepo.deleteFoldersByIds(folderIds, client);
    await client.query("COMMIT");

    return { deletedCount: folderIds.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── Files ────────────────────────────────────────────────────────────────────

/**
 * Returns a presigned PUT URL for direct-to-S3 upload.
 * S3 key pattern: sharepoint/{folderId}/{timestamp}-{sanitizedFilename}
 */
export const generateUploadUrl = async ({ fileName, fileType, folderId, userType, userCompany, businessUnit }) => {
  if (!fileName || !fileType || !folderId) {
    throw new ValidationError("missing_upload_params");
  }

  const exists = await spRepo.verifyFolderBU(folderId, businessUnit);
  if (exists === 0) throw new NotFoundError("record_not_found");
  await assertFolderAccess({ folderId, userType, userCompany, businessUnit });

  const sanitized = fileName.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
  const s3Key = `sharepoint/${folderId}/${Date.now()}-${sanitized}`;

  const command = new PutObjectCommand({
    Bucket: env.aws.bucket,
    Key: s3Key,
    ContentType: fileType,
  });
  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn: 300 });

  return { uploadUrl, s3Key, bucketName: env.aws.bucket };
};

/** Saves the confirmed file record to DB after the S3 upload has completed. */
export const confirmFileUpload = async ({
  folder_id, display_name, s3_key, s3_bucket,
  file_type, file_size, userId, userType, userCompany, businessUnit,
}) => {
  if (!folder_id || !s3_key) throw new ValidationError("missing_confirm_params");

  const exists = await spRepo.verifyFolderBU(folder_id, businessUnit);
  if (exists === 0) throw new NotFoundError("record_not_found");
  await assertFolderAccess({ folderId: folder_id, userType, userCompany, businessUnit });

  return spRepo.insertFile({
    folder_id, display_name, s3_key, s3_bucket,
    file_type, file_size, userId, business_unit: businessUnit,
  });
};

/**
 * Returns a URL for viewing a file — a short-lived signed CloudFront URL when
 * configured, S3 presigned otherwise. Clients fetch a fresh one on every open.
 */
export const getFileViewUrl = async ({ id, userType, userCompany, businessUnit }) => {
  const file = await findAccessibleFile({ fileId: id, userType, userCompany, businessUnit });

  if (env.aws.cloudfrontDomain) {
    return signFileUrl(file.s3_key);
  }

  return getPresignedUrl(file.s3_bucket, file.s3_key, 3600);
};

export const updateFile = async ({ id, display_name, userType, businessUnit }) => {
  if (!isOfficer(userType)) {
    throw new ForbiddenError("officer_only_update_file", "api_errors.files.officer_only_update_file");
  }
  if (!display_name?.trim()) {
    throw new ValidationError("display_name_required", "api_errors.files.display_name_required");
  }

  const updated = await spRepo.updateFileDisplayName(id, display_name, businessUnit);
  if (!updated) throw new NotFoundError("record_not_found");

  return updated;
};

export const deleteFile = async ({ id, userType, businessUnit }) => {
  if (!isOfficer(userType)) {
    throw new ForbiddenError("officer_only_delete_file", "api_errors.files.officer_only_delete_file");
  }

  const file = await spRepo.findFileWithFolderBU(id, businessUnit);
  if (!file) throw new NotFoundError("record_not_found");

  // Cascade: any announcement/chat attachment links to the same S3 object, so
  // remove those reference rows alongside the file (the frontend warns the
  // officer first). DB changes are transactional; the S3 delete is best-effort.
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await attachRepo.deleteAttachmentsByS3Keys([file.s3_key], client);
    await spRepo.deleteFileById(id, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  await deleteFromS3(file.s3_key);
};

// ─── Storage Quota ────────────────────────────────────────────────────────────

/**
 * Returns usedStorage (bytes), maxStorage (bytes), usagePercent, and canUpload.
 * canUpload is false only when usage exceeds 110 %.
 */
export const getStorageQuota = async ({ businessUnit }) => {
  const row = await spRepo.getStorageQuota(businessUnit);
  if (!row) throw new NotFoundError("business_unit_not_found");

  const usedStorage = Number(row.used_storage);
  const maxStorage = Number(row.max_storage_size_bytes);
  const usagePercent = maxStorage > 0 ? (usedStorage / maxStorage) * 100 : 0;
  const canUpload = usagePercent <= 110;

  return { usedStorage, maxStorage, usagePercent, canUpload };
};

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export const getBreadcrumb = async ({ folderId, userType, userCompany, businessUnit }) => {
  await assertFolderAccess({ folderId, userType, userCompany, businessUnit });
  const breadcrumb = await spRepo.findBreadcrumb(folderId, businessUnit);
  return { breadcrumb };
};
