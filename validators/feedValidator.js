/**
 * Feed (Announcement) Validators (Zod)
 */
import { z } from "zod";

const announcementBase = z.object({
  company:      z.array(z.string().uuid()).optional().nullable(),
  batch_no:     z.string().optional().nullable(),
  title:        z.string().min(1, "Title is required"),
  content_text: z.string().optional().nullable(),
  date_from:    z.string().optional().nullable(),
  date_to:      z.string().optional().nullable(),
  active:       z.boolean().optional().default(false),
  comments_on:  z.boolean().optional().default(true),
});

export const createAnnouncementSchema = announcementBase;

export const updateAnnouncementSchema = announcementBase;

export const toggleReactionSchema = z.object({
  emoji: z.string().min(1, "Emoji is required"),
});

export const previewAudienceSchema = z.object({
  company:  z.array(z.string().uuid()).optional().nullable(),
  batch_no: z.string().optional().nullable(),
});
