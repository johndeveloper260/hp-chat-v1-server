import { z } from "zod";

const souserBodySchema = z.object({
  email:          z.string().email(),
  first_name:     z.string().min(1).max(100),
  last_name:      z.string().min(1).max(100),
  display_name:   z.string().max(100).optional(),
  sending_org:    z.string().min(1),
  country:        z.string().min(2).max(5),
  position_title: z.string().max(200).optional(),
  additional_bus: z.array(z.string().max(20)).optional(),
});

// ── POST /souser/create ────────────────────────────────────────────────────────
export const createSouserSchema = souserBodySchema.required({
  email:       true,
  first_name:  true,
  last_name:   true,
  sending_org: true,
  country:     true,
});

// ── PATCH /souser/:id ─────────────────────────────────────────────────────────
export const updateSouserSchema = z.object({
  first_name:     z.string().min(1).max(100).optional(),
  last_name:      z.string().min(1).max(100).optional(),
  display_name:   z.string().max(100).nullable().optional(),
  country:        z.string().min(2).max(5).optional(),
  position_title: z.string().max(200).nullable().optional(),
});
