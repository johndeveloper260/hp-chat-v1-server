/**
 * Stream Routes
 *
 * IMPORTANT: This router is mounted BEFORE express.json() in server.js so that
 * the webhook route can use express.raw() to preserve the raw Buffer for HMAC
 * signature verification.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { getStreamToken } from "../controller/streamController.js";
import { handleChatWebhook } from "../controller/streamChatWebhookController.js";

const router = express.Router();

// Token endpoint — user ID always derived from JWT, never from the URL param
router.get("/token",         auth, getStreamToken);
router.get("/token/:userId", auth, getStreamToken); // backward-compat for web frontend

// Webhook — raw body required for HMAC signature verification (no auth middleware)
router.post("/webhook/chat", express.raw({ type: "application/json" }), handleChatWebhook);

export default router;
