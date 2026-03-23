import crypto from "crypto";
import { getPool } from "../config/getPool.js";
import { sendNotificationToUser } from "./notificationController.js";
import { StreamClient } from "@stream-io/node-sdk";

// In-memory dedup: tracks message IDs already processed (cleared after 5 min)
const processedMessageIds = new Map();

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

/**
 * Verify Stream Chat webhook signature using HMAC-SHA256
 * @param {Buffer|string} rawBody - Raw body as Buffer or string
 * @param {string} signature - x-signature header from Stream
 */
const verifyStreamSignature = (rawBody, signature) => {
  const secret = STREAM_API_SECRET;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  return signature === expectedSignature;
};

/**
 * Stream Chat Webhook Handler for message.new event
 * Expects raw body as Buffer for signature verification
 */
export const handleChatWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-signature"];
    const rawBody = req.body; // Buffer from express.raw()

    // 1. Verify signature using raw body
    if (!verifyStreamSignature(rawBody, signature)) {
      console.error("❌ Invalid webhook signature");
      console.error("Expected secret:", STREAM_API_SECRET?.substring(0, 10) + "...");
      console.error("Received signature:", signature);
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2. Parse JSON body after signature verification
    const body = JSON.parse(rawBody.toString());
    const { type, message, channel_id, channel_type } = body;

    // Only handle message.new events
    if (type !== "message.new") {
      return res.status(200).json({ message: "Event ignored" });
    }

    // 3. Extract sender info
    const senderId = message?.user?.id;
    const senderName = message?.user?.name || "Someone";
    const messageText = message?.text || "";
    const messageId = message?.id;

    if (!senderId || !channel_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Dedup: if this message was already processed (Stream retry), skip silently
    if (messageId && processedMessageIds.has(messageId)) {
      console.log(`⚠️ Duplicate webhook for message ${messageId}, skipping`);
      return res.status(200).json({ message: "Duplicate, skipped" });
    }
    if (messageId) {
      processedMessageIds.set(messageId, Date.now());
      // Clean up entries older than 5 minutes
      const cutoff = Date.now() - 5 * 60 * 1000;
      for (const [id, ts] of processedMessageIds) {
        if (ts < cutoff) processedMessageIds.delete(id);
      }
    }

    console.log(`📨 New message from ${senderName} in channel ${channel_id}`);

    // 4. Get channel members from webhook payload or fetch from API
    let recipientIds = [];

    if (body.members && body.members.length > 0) {
      // Members included in webhook payload
      recipientIds = body.members
        .map(m => m.user_id || m.user?.id)
        .filter(id => id && id !== senderId);
    } else {
      // Fallback: Query Stream API for channel members
      try {
        const streamClient = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET);
        const channelResponse = await streamClient.queryChannels({
          type: channel_type || "messaging",
          id: channel_id,
        });

        if (channelResponse.channels && channelResponse.channels.length > 0) {
          const channelData = channelResponse.channels[0];
          const memberIds = Object.keys(channelData.members || {});
          recipientIds = memberIds.filter(id => id !== senderId);
        }
      } catch (apiError) {
        console.error("Error fetching channel members:", apiError);
      }
    }

    if (recipientIds.length === 0) {
      console.log("No recipients found");
      return res.status(200).json({ message: "No recipients" });
    }

    // 5. Respond immediately so Stream doesn't retry due to timeout
    res.status(200).json({ success: true, recipients: recipientIds.length });

    // 6. Process notifications asynchronously (after response is sent)
    setImmediate(async () => {
      try {
        const senderQuery = await getPool().query(
          `SELECT ua.business_unit, sa.s3_key, sa.s3_bucket
           FROM v4.user_account_tbl ua
           LEFT JOIN v4.shared_attachments sa
             ON sa.relation_id = ua.id::text
             AND sa.relation_type = 'profile'
             AND sa.business_unit = ua.business_unit
           WHERE ua.id = $1
           ORDER BY sa.created_at DESC
           LIMIT 1`,
          [senderId]
        );

        const businessUnit = senderQuery.rows[0]?.business_unit;
        const s3Key = senderQuery.rows[0]?.s3_key;
        const s3Bucket = senderQuery.rows[0]?.s3_bucket;

        const senderProfilePic = s3Key && s3Bucket
          ? `https://${s3Bucket}.s3.ap-northeast-1.amazonaws.com/${s3Key}`
          : null;

        for (const recipientId of recipientIds) {
          await sendNotificationToUser(
            recipientId,
            senderName,
            messageText.substring(0, 100),
            {
              type: "stream_chat",
              channelId: channel_id,
              channelType: channel_type,
              senderId: senderId,
              senderName: senderName,
              senderImage: senderProfilePic,
              messageId: messageId,
              timestamp: Date.now(),
            },
            businessUnit
          );
          console.log(`✅ Sent notification to user ${recipientId}`);
        }
      } catch (bgError) {
        console.error("❌ Background notification error:", bgError);
      }
    });
  } catch (error) {
    console.error("❌ Chat webhook error:", error);
    res.status(500).json({ error: error.message });
  }
};
