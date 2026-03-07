/**
 * Sharepoint Validators (Zod)
 */
import { z } from "zod";

export const createFolderSchema = z.object({
  name:        z.string().min(1, "Folder name is required"),
  parent_id:   z.string().uuid().optional().nullable(),
  company_ids: z.array(z.string()).optional().default([]),
});

export const updateFolderSchema = z.object({
  name:        z.string().optional(),
  company_ids: z.array(z.string()).optional(),
});

export const generateUploadUrlSchema = z.object({
  fileName:  z.string().min(1, "fileName is required"),
  fileType:  z.string().min(1, "fileType is required"),
  folderId:  z.string().uuid("folderId must be a valid UUID"),
});

export const confirmFileUploadSchema = z.object({
  folder_id:    z.string().uuid("folder_id must be a valid UUID"),
  display_name: z.string().optional().nullable(),
  s3_key:       z.string().min(1, "s3_key is required"),
  s3_bucket:    z.string().min(1, "s3_bucket is required"),
  file_type:    z.string().optional().nullable(),
  file_size:    z.number().optional().nullable(),
});
