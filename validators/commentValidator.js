import { z } from "zod";

export const addCommentSchema = z.object({
  relation_type:     z.enum(["inquiries", "announcements"]),
  relation_id:       z.coerce.string().min(1),
  content_text:      z.string().min(1),
  parent_comment_id: z.coerce.string().optional().nullable(),
  metadata:          z.record(z.unknown()).optional(),
});

export const editCommentSchema = z.object({
  content_text: z.string().min(1),
});
