/**
 * Feed (Announcement) Validators (Zod)
 */
import { z } from "zod";

const pollOptionLabel = z.string().trim().min(1).max(100);

/**
 * An option is a bare label (what the first clients send) or an object that
 * can also require a written explanation from whoever picks it. Both parse to
 * the object form so the service and repository see one shape.
 */
const pollOptionSchema = z.union([
  pollOptionLabel.transform((label) => ({ label, requires_note: false })),
  z.object({
    label:         pollOptionLabel,
    requires_note: z.boolean().optional().default(false),
  }),
]);

export const pollInputSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(pollOptionSchema).min(2).max(10)
    .refine((options) => new Set(options.map((option) => option.label.toLowerCase())).size === options.length, "Options must be unique"),
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
  // option_id → explanation. Required for options flagged requires_note;
  // the service enforces that, since it needs the poll definition.
  notes: z.record(z.string().uuid(), z.string().trim().max(500)).optional().default({}),
});

export const pollLockSchema = z.object({ locked: z.boolean() });
