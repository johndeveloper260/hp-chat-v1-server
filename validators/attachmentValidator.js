/**
 * Attachment Validators (Zod)
 */
import { z } from "zod";

/** POST /attachments/generate-url — request a presigned PUT URL for upload */
export const generateUrlSchema = z.object({
  fileName:    z.string().min(1, "fileName is required"),
  fileType:    z.string().min(1, "fileType is required"),
  relationType: z.string().min(1, "relationType is required"),
  relationId:   z.union([z.string(), z.number()]),
});

/** POST /attachments/confirm — save DB record after S3 upload completes */
export const createAttachmentSchema = z.object({
  relation_type: z.string().min(1),
  relation_id:   z.union([z.string(), z.number()]),
  s3_key:        z.string().min(1),
  s3_bucket:     z.string().min(1),
  display_name:  z.string().optional().nullable(),
  file_type:     z.string().optional().nullable(),
});

/** PUT /attachments/:id/rename */
export const renameAttachmentSchema = z.object({
  display_name: z.string().min(1, "Display name is required"),
});
