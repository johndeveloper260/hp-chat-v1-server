/**
 * Visa List Validators (Zod)
 */
import { z } from "zod";

const descrSchema = z.object({
  en: z.string().min(1),
  ja: z.string().min(1),
});

const visaListBodySchema = z.object({
  code:       z.string().max(10),
  descr:      descrSchema,
  active:     z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// ── POST /visa-list/create ─────────────────────────────────────────────────────
export const createVisaListSchema = visaListBodySchema.required({ code: true });

// ── PUT /visa-list/update/:id ── code is immutable; omit from update ───────────
export const updateVisaListSchema = visaListBodySchema.omit({ code: true });
