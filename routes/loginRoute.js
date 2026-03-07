/**
 * Login Routes
 *
 * Every body-bearing route is guarded by the Zod validate() middleware.
 * Validation failures are forwarded to the global errorHandler as ZodErrors.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  loginSchema,
  forgotPasswordSchema,
  updatePasswordSchema,
  requestDeletionSchema,
  verifyDeletionSchema,
} from "../validators/loginValidator.js";
import {
  loginUser,
  handleForgotPassword,
  updatePassword,
  deleteUserAccount,
  requestWebDeletion,
  finalizeDeletion,
  adminDeleteUser,
} from "../controller/loginController.js";

const router = express.Router();

// ── Public ────────────────────────────────────────────────────────────────────
router.post("/loginUser",       validate(loginSchema),           loginUser);
router.post("/forgot-password", validate(forgotPasswordSchema),  handleForgotPassword);

// ── Authenticated ─────────────────────────────────────────────────────────────
router.post("/updatePassword",  auth, validate(updatePasswordSchema), updatePassword);
router.delete("/deleteAccount", auth,                                  deleteUserAccount);

// ── Officer / Admin ───────────────────────────────────────────────────────────
router.delete("/admin-delete-user/:userId", auth, adminDeleteUser);

// ── Public Web Deletion Flow ──────────────────────────────────────────────────
router.post("/requestWebDeletion",     validate(requestDeletionSchema), requestWebDeletion);
router.post("/verifyAndExcludeAccount", validate(verifyDeletionSchema), finalizeDeletion);

export default router;
