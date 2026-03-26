/**
 * Issue Type Validators (Zod)
 */
import { z } from "zod";

const descrSchema = z.object({
  en: z.string().min(1),
  ja: z.string().min(1),
});

const issueTypeBodySchema = z.object({
  code:       z.string().max(10).optional(),
  descr:      descrSchema,
  active:     z.boolean().optional(),
  sort_order: z.number().int().optional(),
});

// ── POST /issue-type/create ────────────────────────────────────────────────────
export const createIssueTypeSchema = issueTypeBodySchema.required({ code: true });

// ── PUT /issue-type/update/:code ── code is immutable; omit from update ────────
export const updateIssueTypeSchema = issueTypeBodySchema.omit({ code: true });
