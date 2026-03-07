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
import { getSignedUrl }                    from "@aws-sdk/s3-request-presigner";
import { PutObjectCommand }                from "@aws-sdk/client-s3";
import * as spRepo                         from "../repositories/sharepointRepository.js";
import { NotFoundError, ForbiddenError, ValidationError } from "../errors/AppError.js";

const OFFICER_TYPES = ["officer", "admin"];
const isOfficer = (userType) => OFFICER_TYPES.includes(userType?.toLowerCase());

// ─── Folders ──────────────────────────────────────────────────────────────────

/**
 * Returns { folders, files } for the given parent folder.
 * Officers see all root folders; trainees see only company-scoped root folders.
 * Any user can navigate into sub-folders once the parent is accessible.
 */
export const getFolders = async ({ userType, userCompany, businessUnit, parent_id }) => {
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

export const createFolder = async ({ name, parent_id, company_ids, userId, userType, businessUnit }) => {
  if (!isOfficer(userType) && !parent_id) {
    throw new ForbiddenError("officer_only_create", "api_errors.files.officer_only_create");
  }
  if (!name || !name.trim()) {
    throw new ValidationError("folder_name_required", "api_errors.files.folder_name_required");
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
export const generateUploadUrl = async ({ fileName, fileType, folderId, businessUnit }) => {
  if (!fileName || !fileType || !folderId) {
    throw new ValidationError("missing_upload_params");
  }

  const exists = await spRepo.verifyFolderBU(folderId, businessUnit);
  if (exists === 0) throw new NotFoundError("record_not_found");

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
  file_type, file_size, userId, businessUnit,
}) => {
  if (!folder_id || !s3_key) throw new ValidationError("missing_confirm_params");

  const exists = await spRepo.verifyFolderBU(folder_id, businessUnit);
  if (exists === 0) throw new NotFoundError("record_not_found");

  return spRepo.insertFile({
    folder_id, display_name, s3_key, s3_bucket,
    file_type, file_size, userId, business_unit: businessUnit,
  });
};

/** Returns a 1-hour presigned GET URL for viewing a file. */
export const getFileViewUrl = async ({ id, businessUnit }) => {
  const file = await spRepo.findFileWithFolderBU(id, businessUnit);
  if (!file) throw new NotFoundError("record_not_found");

  return getPresignedUrl(file.s3_bucket, file.s3_key, 3600);
};

export const deleteFile = async ({ id, userType, businessUnit }) => {
  if (!isOfficer(userType)) {
    throw new ForbiddenError("officer_only_delete_file", "api_errors.files.officer_only_delete_file");
  }

  const file = await spRepo.findFileWithFolderBU(id, businessUnit);
  if (!file) throw new NotFoundError("record_not_found");

  await deleteFromS3(file.s3_key);
  await spRepo.deleteFileById(id);
};

// ─── Breadcrumb ───────────────────────────────────────────────────────────────

export const getBreadcrumb = async ({ folderId, businessUnit }) => {
  const breadcrumb = await spRepo.findBreadcrumb(folderId, businessUnit);
  return { breadcrumb };
};
