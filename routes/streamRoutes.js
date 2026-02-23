import express from "express";
import auth from "../middleware/auth.js";

const router = express.Router();

// 1. Change require to a named import and add the .js extension
import { getStreamToken } from "../controller/streamController.js";
import { handleChatWebhook } from "../controller/streamChatWebhookController.js";

// @route   GET /stream/token
// @desc    Generate a Stream token for the authenticated user (ID taken from JWT).
//          The mobile app uses this paramless variant.
router.get("/token", auth, getStreamToken);

// @route   GET /stream/token/:userId  (kept for web frontend backward compatibility)
// @desc    Same handler — the :userId param is accepted but the controller
//          derives the user ID from the verified JWT (req.user.id), not the URL.
router.get("/token/:userId", auth, getStreamToken);

// @route   POST /stream/webhook/chat
// @desc    Handle Stream Chat webhooks (no auth - verified by signature)
// IMPORTANT: Uses raw body middleware to preserve original bytes for HMAC verification
router.post(
  "/webhook/chat",
  express.raw({ type: "application/json" }),
  handleChatWebhook
);

// 2. Change module.exports to export default
export default router;
