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
  // "Allow bulletin writing" — default off. Absent means off; the officer has
  // to opt in, both here and on the SO User Management screen.
  announcements_read: z.boolean().optional(),
  announcements_write: z.boolean().optional().default(false),
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

// ── PATCH /souser/:id/reset-password ─────────────────────────────────────────
export const resetSouserPasswordSchema = z.object({
  new_password: z.string().min(6).max(128),
});

// ── PATCH /souser/me ──────────────────────────────────────────────────────────
export const updateSouserSelfSchema = z.object({
  first_name:     z.string().min(1).max(100).optional(),
  last_name:      z.string().min(1).max(100).optional(),
  display_name:   z.string().max(100).nullable().optional(),
  position_title: z.string().max(200).nullable().optional(),
});

// ── PATCH /souser/:id/toggle ──────────────────────────────────────────────────
// is_active is optional so existing clients that send an empty body still flip
// the state; sending it explicitly makes a retry idempotent.
export const toggleSouserActiveSchema = z.object({
  is_active: z.boolean().optional(),
});

// ── POST /souser/:id/bu-access ────────────────────────────────────────────────
export const grantBuAccessSchema = z.object({
  business_unit: z.string().min(1).max(20),
});

// ── PATCH /souser/:id/bu-access/:bu/permissions ───────────────────────────────
export const buAccessPermissionsSchema = z.object({
  announcements_read:  z.boolean(),
  announcements_write: z.boolean(),
});

// ── PATCH /souser/:id/announcements-write ─────────────────────────────────────
export const announcementsWriteSchema = z.object({
  announcements_write: z.boolean(),
});
