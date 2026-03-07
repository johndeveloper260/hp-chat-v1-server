/**
 * Inquiry Validators (Zod)
 */
import { z } from "zod";

export const createInquirySchema = z.object({
  title:       z.string().min(1, "Title is required"),
  description: z.string().optional().nullable(),
  occur_date:  z.string().optional().nullable(),
  type:        z.string().optional().nullable(),
  high_pri:    z.boolean().optional().default(false),
  company:     z.string().optional().nullable(),
  watcher:     z.array(z.string()).optional().default([]),
  owner_id:    z.string().uuid().optional().nullable(),
  opened_by:   z.string().uuid().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

export const updateInquirySchema = z.object({
  status:      z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  resolution:  z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  high_pri:    z.boolean().optional(),
  watcher:     z.array(z.string()).optional(),
  closed_dt:   z.string().optional().nullable(),
  title:       z.string().optional(),
  type:        z.string().optional().nullable(),
  occur_date:  z.string().optional().nullable(),
});
