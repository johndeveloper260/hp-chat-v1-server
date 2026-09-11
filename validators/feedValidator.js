/**
 * Feed (Announcement) Validators (Zod)
 */
import { z } from "zod";

export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(100)).min(2).max(10)
    .refine((options) => new Set(options.map((option) => option.toLowerCase())).size === options.length, "Options must be unique"),
  allow_multiple: z.boolean().optional().default(false),
  closes_at: z.string().datetime({ offset: true }).nullable().optional(),
});

const announcementBase = z.object({
  company:      z.array(z.string().uuid()).optional().nullable(),
  batch_no:     z.string().optional().nullable(),
  country:      z.array(z.string()).optional().nullable(),
  sending_org:  z.string().optional().nullable(),
  title:        z.string().min(1, "Title is required"),
  content_text: z.string().optional().nullable(),
  date_from:    z.string().optional().nullable(),
  date_to:      z.string().optional().nullable(),
  active:       z.boolean().optional().default(false),
  comments_on:  z.boolean().optional().default(true),
  poll:         pollInputSchema.nullable().optional(),
});

export const createAnnouncementSchema = announcementBase;

export const updateAnnouncementSchema = announcementBase;

export const toggleReactionSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
});

export const previewAudienceSchema = z.object({
  company:     z.array(z.string().uuid()).optional().nullable(),
  batch_no:    z.string().optional().nullable(),
  country:     z.array(z.string()).optional().nullable(),
  sending_org: z.string().optional().nullable(),
});

export const pollRespondSchema = z.object({
  option_ids: z.array(z.string().uuid()).min(1).max(10),
});

export const pollLockSchema = z.object({ locked: z.boolean() });
