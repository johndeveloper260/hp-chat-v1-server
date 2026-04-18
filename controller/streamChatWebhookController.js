import crypto from "crypto";
import { getPool } from "../config/getPool.js";
import { sendNotificationToUser } from "./notificationController.js";
import { StreamClient } from "@stream-io/node-sdk";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";

const STREAM_API_KEY = process.env.STREAM_API_KEY;
const STREAM_API_SECRET = process.env.STREAM_API_SECRET;

let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) _streamChat = StreamChat.getInstance(STREAM_API_KEY, STREAM_API_SECRET);
  return _streamChat;
};

// ── Translation providers ──────────────────────────────────────────────────

/**
 * Google Translate (free gtx endpoint). Returns { translatedText, detectedSourceLanguage } or null.
 */
const gtxTranslate = async (text, targetLang) => {
  try {
    const url = new URL("https://translate.googleapis.com/translate_a/single");
    url.searchParams.set("client", "gtx");
    url.searchParams.set("sl", "auto");
    url.searchParams.set("tl", targetLang);
    url.searchParams.set("dt", "t");
    url.searchParams.set("q", text);

    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = await res.json();

    let translatedText = "";
    if (data?.[0]) {
      for (const item of data[0]) {
        if (item[0]) translatedText += item[0];
      }
    }
    return {
      translatedText: translatedText || text,
      detectedSourceLanguage: data?.[2] || "auto",
    };
  } catch {
    return null;
  }
};

/**
 * GPT-4o mini. Returns { translatedText, detectedSourceLanguage } or null.
 */
const gptTranslate = async (text, targetLang) => {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.openai.apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              `Translate the chat message to language code "${targetLang}". ` +
              `Match the informality of the source. Preserve emoji and punctuation. ` +
              `Reply ONLY with valid JSON: {"translated":"<text>","source":"<ISO 639-1 code>"}.`,
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        max_tokens: 500,
        temperature: 0.1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    return {
      translatedText: parsed.translated || text,
      detectedSourceLanguage: parsed.source || "auto",
    };
  } catch {
    return null;
  }
};

// Picks the active provider at runtime — no restart needed if env changes.
const activeTranslate = (text, targetLang) =>
  env.translation.provider === "openai"
    ? gptTranslate(text, targetLang)
    : gtxTranslate(text, targetLang);

/**
 * Translate a message to all unique languages needed by channel recipients
 * who have auto_translate_chat enabled, then store results as Stream custom
 * fields so clients can read them for free (no client-side API call needed).
 */
const translateAndCacheMessage = async (messageId, messageText, recipientIds) => {
  if (!messageText?.trim() || !messageId) return;

  try {
    console.log(`🔤 [AutoTranslate] Starting for message ${messageId}, recipients: [${recipientIds.join(", ")}]`);

    // 1. Get preferred_language for recipients that have auto_translate_chat ON
    const { rows } = await getPool().query(
      `SELECT DISTINCT preferred_language
       FROM v4.user_account_tbl
       WHERE id = ANY($1::uuid[])
         AND auto_translate_chat = true
         AND preferred_language IS NOT NULL`,
      [recipientIds],
    );

    if (rows.length === 0) {
      console.log(`🔤 [AutoTranslate] No recipients with auto_translate_chat=true, skipping`);
      return;
    }

    const targetLangs = rows.map((r) => r.preferred_language);
    console.log(`🔤 [AutoTranslate] Target languages: [${targetLangs.join(", ")}]`);

    // 2. Translate to the first target lang to detect the source language
    const first = await activeTranslate(messageText, targetLangs[0]);
    if (!first) {
      console.log(`🔤 [AutoTranslate] gtxTranslate failed for lang=${targetLangs[0]}`);
      return;
    }

    const sourceLang = first.detectedSourceLanguage;
    console.log(`🔤 [AutoTranslate] Detected source language: ${sourceLang}`);
    const updates = {};

    // Store first translation (skip if source = target)
    if (sourceLang !== targetLangs[0]) {
      const key = `translations_${targetLangs[0]}`;
      updates[key]               = first.translatedText;
      updates[`${key}_source`]   = sourceLang;
      updates[`${key}_original`] = messageText;
    } else {
      console.log(`🔤 [AutoTranslate] Skipping ${targetLangs[0]} — same as source`);
    }

    // 3. Translate remaining languages in parallel
    const rest = await Promise.all(
      targetLangs.slice(1).map(async (lang) => {
        if (lang === sourceLang) {
          console.log(`🔤 [AutoTranslate] Skipping ${lang} — same as source`);
          return null;
        }
        const result = await activeTranslate(messageText, lang);
        if (!result) return null;
        return { lang, result };
      }),
    );

    for (const item of rest) {
      if (!item) continue;
      const key = `translations_${item.lang}`;
      updates[key]               = item.result.translatedText;
      updates[`${key}_source`]   = sourceLang;
      updates[`${key}_original`] = messageText;
    }

    if (Object.keys(updates).length === 0) {
      console.log(`🔤 [AutoTranslate] No updates to store (all targets match source language)`);
      return;
    }

    console.log(`🔤 [AutoTranslate] Storing ${Object.keys(updates).length} fields on message ${messageId}`);
    await getStreamChat().partialUpdateMessage(messageId, { set: updates });
    console.log(`🌐 [AutoTranslate] Done — message ${messageId} translated to [${targetLangs.join(", ")}]`);
  } catch (err) {
    console.error(`❌ [AutoTranslate] Error for message ${messageId}:`, err);
  }
};

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

    // Dedup: use DB INSERT ON CONFLICT so all server instances share the same state
    if (messageId) {
      const { rowCount } = await getPool().query(
        `INSERT INTO v4.processed_webhook_messages (message_id, processed_at)
         VALUES ($1, NOW())
         ON CONFLICT (message_id) DO NOTHING`,
        [messageId]
      );
      if (rowCount === 0) {
        console.log(`⚠️ Duplicate webhook for message ${messageId}, skipping`);
        return res.status(200).json({ message: "Duplicate, skipped" });
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

    // 6. Process notifications + translation asynchronously (after response is sent)
    setImmediate(async () => {
      // Translate and cache on Stream in parallel with notifications
      translateAndCacheMessage(messageId, messageText, recipientIds);

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
