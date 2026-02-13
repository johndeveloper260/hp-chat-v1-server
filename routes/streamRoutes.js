import express from "express";
import auth from "../middleware/auth.js";

const router = express.Router();

// 1. Change require to a named import and add the .js extension
import { getStreamToken } from "../controller/streamController.js";
import { handleChatWebhook } from "../controller/streamChatWebhookController.js";

// @route   GET /stream/token/:userId
// @desc    Generate a Stream Chat token for a user
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
