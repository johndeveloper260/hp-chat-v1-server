/**
 * Stream Routes
 *
 * IMPORTANT: This router is mounted BEFORE express.json() in server.js so that
 * the webhook route can use express.raw() to preserve the raw Buffer for HMAC
 * signature verification.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { getStreamToken, addChannelMember } from "../controller/streamController.js";
import { handleChatWebhook } from "../controller/streamChatWebhookController.js";
import { runStreamSync } from "../jobs/streamSyncJob.js";

const router = express.Router();

// Token endpoint — user ID always derived from JWT, never from the URL param
router.get("/token",         auth, getStreamToken);
router.get("/token/:userId", auth, getStreamToken); // backward-compat for web frontend

// Add member via server-side admin client (bypasses channel permission restrictions)
// express.json() is applied inline because this router is mounted before the global body parser
router.post("/channel/add-member", express.json(), auth, addChannelMember);

// Webhook — raw body required for HMAC signature verification (no auth middleware)
router.post("/webhook/chat", express.raw({ type: "application/json" }), handleChatWebhook);

// Manual sync trigger — admin/officer only
router.post("/sync/run", express.json(), auth, async (req, res, next) => {
  try {
    const result = await runStreamSync();
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
