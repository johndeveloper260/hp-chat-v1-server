/**
 * Sending Org Validators (Zod)
 */
import { z } from "zod";

const sendingOrgBodySchema = z.object({
  code:           z.string().max(3).optional(),
  descr:          z.string().optional().nullable(),
  country_origin: z.string().max(3).optional().nullable(),
  msgnbr:         z.string().max(5).optional().nullable(),
  msgset:         z.string().max(5).optional().nullable(),
  sort_order:     z.number().int().optional(),
  active:         z.boolean().optional(),
});

// ── POST /sending-org/create ───────────────────────────────────────────────────
export const createSendingOrgSchema = sendingOrgBodySchema.required({ code: true });

// ── PUT /sending-org/update/:code ──────────────────────────────────────────────
export const updateSendingOrgSchema = sendingOrgBodySchema.omit({ code: true });
