/**
 * Login Validators (Zod)
 */
import { z } from "zod";

// ── POST /login/loginUser ────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Must be a valid email address")
    .transform((v) => v.toLowerCase().trim()),

  password: z
    .string({ required_error: "Password is required" })
    .min(1, "Password is required"),
});

// ── POST /login/forgot-password ───────────────────────────────────────────
export const forgotPasswordSchema = z.object({
  email: z
    .string({ required_error: "Email is required" })
    .email("Must be a valid email address")
    .transform((v) => v.toLowerCase().trim()),
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
