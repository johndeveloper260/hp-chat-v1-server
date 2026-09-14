/**
 * Login Validators (Zod)
 */
import { z } from "zod";
import { normalizeLoginId, TEMP_LOGIN_ID_RE } from "../config/constants.js";

// ── POST /login/loginUser ────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .refine((v) => z.email().safeParse(v).success || TEMP_LOGIN_ID_RE.test(v),
      "Must be a valid email address or temporary login ID")
    .transform(normalizeLoginId),

  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required"),
});

// ── POST /login/forgot-password ───────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .trim()
    .refine((v) => z.email().safeParse(v).success || TEMP_LOGIN_ID_RE.test(v),
      "Must be a valid email address or temporary login ID")
    .transform(normalizeLoginId),
});

// ── POST /login/updatePassword ────────────────────────────────────────────
export const updatePasswordSchema = z.object({
  newPassword: z
    .string({ required_error: "New password is required" })
    .min(6, "Password must be at least 6 characters"),
});

// ── POST /login/verifyAndExcludeAccount ───────────────────────────────────
export const verifyDeletionSchema = z.object({
  email: z.string().email().optional(),
  otpCode: z.string().optional(),
});

// ── POST /login/requestWebDeletion ───────────────────────────────────────
export const requestDeletionSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Must be a valid email address")
    .transform((v) => v.toLowerCase().trim()),
});

export const activationRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email address"),
});

export const activationSchema = activationRequestSchema.extend({
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
