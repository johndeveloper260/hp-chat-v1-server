import { z } from "zod";

export const saveLeaveTemplateSchema = z.object({
  config:       z.union([z.string(), z.record(z.unknown())]),
  fields:       z.union([z.string(), z.array(z.unknown())]),
  template_id:  z.string().optional().nullable(),
  company_id:   z.string().optional().nullable(),
  title:        z.string().optional(),
  description:  z.string().optional().nullable(),
  category:     z.string().optional().nullable(),
  is_published: z.boolean().optional(),
});

export const submitLeaveSchema = z.object({
  templateId:   z.string().min(1),
  answers:      z.union([z.string(), z.record(z.unknown())]),
  targetUserId: z.string().optional().nullable(),
});
