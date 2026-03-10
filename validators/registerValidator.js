/**
 * Register Validators (Zod)
 *
 * Used by middleware/validate.js to enforce request shapes
 * before the request reaches the controller.
 */
import { z } from "zod";

// ── POST /register/validate-code ──────────────────────────────────────────
export const validateCodeSchema = z.object({
  code: z.string().min(1, "Code is required"),
});

// ── POST /register/registerUser ───────────────────────────────────────────
export const registerSchema = z.object({
  // Required
  email: z
    .string({ required_error: "Email is required" })
    .email("Must be a valid email address")
    .transform((v) => v.toLowerCase().trim()),

  password: z
    .string({ required_error: "Password is required" })
    .min(8, "Password must be at least 8 characters"),

  firstName: z
    .string({ required_error: "First name is required" })
    .min(1, "First name is required")
    .trim(),

  lastName: z.string().trim().optional().nullable(),

  registrationCode: z
    .string({ required_error: "Registration code is required" })
    .min(1, "Registration code is required"),

  // Optional
  middleName: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  phoneNumber: z.string().optional().nullable(),
  visaType: z.string().optional().nullable(),
  visaExpiry: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  streetAddress: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  companyBranch: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  sendingOrg: z.string().optional().nullable(),
  batchNo: z.string().optional().nullable(),
});
