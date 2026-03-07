/**
 * Access / Role-management Validators (Zod)
 */
import { z } from "zod";

// ── POST /access/roles/:userId ────────────────────────────────────────────────
export const assignRoleSchema = z.object({
  role_name: z.string({ required_error: "role_name is required" }).min(1, "role_name is required"),
});

// ── PUT /access/roles/:userId ─────────────────────────────────────────────────
export const replaceRolesSchema = z.object({
  roles: z.array(z.string().min(1)).min(0, "roles must be an array"),
});
