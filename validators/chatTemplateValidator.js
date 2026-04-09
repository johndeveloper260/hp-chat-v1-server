/**
 * Chat Template Validators (Zod)
 */
import { z } from "zod";

const templateBodySchema = z.object({
  title:      z.string().min(1, "Title is required").max(100).trim(),
  body:       z.string().min(1, "Body is required").trim(),
  category:   z.string().max(50).trim().optional().nullable(),
  sort_order: z.number().int().min(0).optional(),
  is_active:  z.boolean().optional(),
});

// ── POST /chat-templates/create ───────────────────────────────────────────────
export const createTemplateSchema = templateBodySchema;

// ── PUT /chat-templates/update/:id ────────────────────────────────────────────
export const updateTemplateSchema = templateBodySchema.extend({
  is_active: z.boolean(),
});

// ── PATCH /chat-templates/reorder ─────────────────────────────────────────────
export const reorderSchema = z.object({
  updates: z
    .array(
      z.object({
        id:         z.string().uuid(),
        sort_order: z.number().int().min(0),
      }),
    )
    .min(1),
});
