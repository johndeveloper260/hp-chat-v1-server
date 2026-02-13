import crypto from "crypto";
import { getPool } from "../config/getPool.js";
import { sendNotificationToUser } from "./notificationController.js";
import { StreamClient } from "@stream-io/node-sdk";

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;


/**
 * Verify Stream Chat webhook signature
 */
const verifySignature = (body, signature) => {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex");
  return hash === signature;
};

/**
 * Stream Chat Webhook Handler for message.new event
 */
export const handleChatWebhook = async (req, res) => {
  try {
    const signature = req.headers["x-signature"];
    const body = req.body;

    // 1. Verify signature
    if (!verifySignature(body, signature)) {
      console.error("❌ Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }

    // 2. Extract event type
    const { type, message, channel_id, channel_type } = body;

    // Only handle message.new events
    if (type !== "message.new") {
      return res.status(200).json({ message: "Event ignored" });
    }

    // 3. Extract sender info
    const senderId = message?.user?.id;
    const senderName = message?.user?.name || "Someone";
    const messageText = message?.text || "";

    if (!senderId || !channel_id) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log(`📨 New message from ${senderName} in channel ${channel_id}`);

    // 4. Get channel members from Stream API
    const streamClient = new StreamClient(STREAM_API_KEY, STREAM_API_SECRET);
    const channel = streamClient.chat.channel(channel_type || "messaging", channel_id);
    const channelState = await channel.query({ members: { limit: 100 } });

    const members = channelState.members || [];
    const recipientIds = members
      .map(m => m.user_id)
      .filter(id => id !== senderId);

    if (recipientIds.length === 0) {
      console.log("No recipients found");
      return res.status(200).json({ message: "No recipients" });
    }

    // 5. Get sender's business_unit and profile picture from shared_attachments
    const senderQuery = await getPool().query(
      `SELECT ua.business_unit, sa.file_path
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
    const senderProfilePic = senderQuery.rows[0]?.file_path || null;

    // 6. Send notifications to all recipients
    for (const recipientId of recipientIds) {

      // Use existing notification service
      await sendNotificationToUser(
        recipientId,
        senderName,
        messageText.substring(0, 100), // Truncate long messages
        {
          type: "stream_chat",
          channelId: channel_id,
          channelType: channel_type,
          senderId: senderId,
          senderName: senderName,
          senderImage: senderProfilePic,
          messageId: message.id,
          timestamp: Date.now(),
        },
        businessUnit
      );

      console.log(`✅ Sent notification to user ${recipientId}`);
    }

    res.status(200).json({ success: true, recipients: recipientIds.length });
  } catch (error) {
    console.error("❌ Chat webhook error:", error);
    res.status(500).json({ error: error.message });
  }
};
