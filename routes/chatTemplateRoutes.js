/**
 * Chat Template Routes
 *
 * GET  /chat-templates/active    — any authenticated user (chat sidebar)
 * GET  /chat-templates/list      — chat_template_write (admin page)
 * POST /chat-templates/create    — chat_template_write
 * PUT  /chat-templates/update/:id — chat_template_write
 * DELETE /chat-templates/delete/:id — chat_template_write
 * PATCH /chat-templates/reorder  — chat_template_write
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole, requireOfficer } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import {
  createTemplateSchema,
  updateTemplateSchema,
  reorderSchema,
} from "../validators/chatTemplateValidator.js";
import {
  getActiveTemplates,
  getAllTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  reorderTemplates,
} from "../controller/chatTemplateController.js";

const router = express.Router();

// ── officer/admin only (sousers and users excluded) ──────────────────────────
router.get("/active", auth, requireOfficer, getActiveTemplates);

// ── chat_template_write ───────────────────────────────────────────────────────
router.get(   "/list",         auth, requireRole("chat_template_write"), getAllTemplates);
router.post(  "/create",       auth, requireRole("chat_template_write"), validate(createTemplateSchema), createTemplate);
router.put(   "/update/:id",   auth, requireRole("chat_template_write"), validate(updateTemplateSchema), updateTemplate);
router.delete("/delete/:id",   auth, requireRole("chat_template_write"),                                 deleteTemplate);
router.patch( "/reorder",      auth, requireRole("chat_template_write"), validate(reorderSchema),        reorderTemplates);

export default router;
