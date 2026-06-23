import crypto from "crypto";
import { getPool } from "../config/getPool.js";
import { sendNotificationToUser } from "./notificationController.js";
import { StreamClient } from "@stream-io/node-sdk";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";
import logger from "../utils/logger.js";

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
const sanitizeOpenAIError = (text) => text.replace(/sk-[A-Za-z0-9_*.-]+/g, "sk-***");

const getTranslationMaxTokens = (text) => {
  const estimatedOutputTokens = Math.ceil(text.length / 2);
  return Math.min(4096, Math.max(1000, estimatedOutputTokens));
};

const hasMissingLines = (original, translated) => {
  const originalLines = original.split(/\r?\n/).filter((line) => line.trim()).length;
  const translatedLines = translated.split(/\r?\n/).filter((line) => line.trim()).length;
  return originalLines > 1 && translatedLines < originalLines;
};

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
              `Translate every line completely. Do not summarize, omit, merge, or shorten any line. ` +
              `Preserve the original line breaks, line order, emoji, punctuation, and informality. ` +
              `Reply ONLY with valid JSON: {"translated":"<text>","source":"<ISO 639-1 code>"}.`,
          },
          { role: "user", content: text },
        ],
        response_format: { type: "json_object" },
        max_tokens: getTranslationMaxTokens(text),
        temperature: 0.1,
      }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      logger.error(
        `❌ [AutoTranslate] OpenAI API error: ${res.status} ${sanitizeOpenAIError(errorText).slice(0, 500)}`,
      );
      return null;
    }
    const data = await res.json();
    if (data.choices?.[0]?.finish_reason === "length") {
      logger.error("❌ [AutoTranslate] OpenAI translation was truncated by token limit.");
      return null;
    }
    const parsed = JSON.parse(data.choices[0].message.content);
    const translatedText = parsed.translated || text;
    if (hasMissingLines(text, translatedText)) {
      logger.error("❌ [AutoTranslate] OpenAI translation omitted one or more source lines.");
      return null;
    }
    return {
      translatedText,
      detectedSourceLanguage: parsed.source || "auto",
    };
  } catch (err) {
    logger.error("❌ [AutoTranslate] OpenAI translation error:", err);
    return null;
  }
};

// Picks the active provider at runtime — no restart needed if env changes.
const activeTranslate = (text, targetLang) => {
  const provider = env.translation.provider === "openai" ? "gpt-4o-mini" : "google-gtx";
  logger.info(`🔤 [AutoTranslate] Provider: ${provider} → lang=${targetLang}`);
  return env.translation.provider === "openai"
    ? gptTranslate(text, targetLang)
    : gtxTranslate(text, targetLang);
};

/**
 * Translate a message to all unique languages needed by channel recipients
 * who have auto_translate_chat enabled, then store results as Stream custom
 * fields so clients can read them for free (no client-side API call needed).
 */
const translateAndCacheMessage = async (messageId, messageText, recipientIds, senderId) => {
  if (!messageText?.trim() || !messageId) return;

  try {
    logger.info(`🔤 [AutoTranslate] Starting for message ${messageId}, recipients: [${recipientIds.join(", ")}]`);

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
      logger.info(`🔤 [AutoTranslate] No recipients with auto_translate_chat=true, skipping`);
      return;
    }

    const targetLangs = rows.map((r) => r.preferred_language);
    logger.info(`🔤 [AutoTranslate] Target languages: [${targetLangs.join(", ")}]`);

    // 2. Translate to the first target lang to detect the source language
    const first = await activeTranslate(messageText, targetLangs[0]);
    if (!first) {
      logger.info(`🔤 [AutoTranslate] Translation failed for lang=${targetLangs[0]}`);
      return;
    }

    const sourceLang = first.detectedSourceLanguage;
    logger.info(`🔤 [AutoTranslate] Detected source language: ${sourceLang}`);
    const updates = {};

    // Store first translation (skip if source = target)
    if (sourceLang !== targetLangs[0]) {
      const key = `translations_${targetLangs[0]}`;
      updates[key]               = first.translatedText;
      updates[`${key}_source`]   = sourceLang;
      updates[`${key}_original`] = messageText;
    } else {
      logger.info(`🔤 [AutoTranslate] Skipping ${targetLangs[0]} — same as source`);
    }

    // 3. Translate remaining languages in parallel
    const rest = await Promise.all(
      targetLangs.slice(1).map(async (lang) => {
        if (lang === sourceLang) {
          logger.info(`🔤 [AutoTranslate] Skipping ${lang} — same as source`);
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
      logger.info(`🔤 [AutoTranslate] No updates to store (all targets match source language)`);
      return;
    }

    logger.info(`🔤 [AutoTranslate] Storing ${Object.keys(updates).length} fields on message ${messageId}`);
    await getStreamChat().partialUpdateMessage(messageId, { set: updates }, senderId);
    logger.info(`🌐 [AutoTranslate] Done — message ${messageId} translated to [${targetLangs.join(", ")}]`);
  } catch (err) {
    logger.error(`❌ [AutoTranslate] Error for message ${messageId}:`, err);
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
      logger.error("❌ Invalid webhook signature");
      logger.error("Expected secret:", STREAM_API_SECRET?.substring(0, 10) + "...");
      logger.error("Received signature:", signature);
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
        logger.info(`⚠️ Duplicate webhook for message ${messageId}, skipping`);
        return res.status(200).json({ message: "Duplicate, skipped" });
      }
    }

    logger.info(`📨 New message from ${senderName} in channel ${channel_id}`);

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
        logger.error("Error fetching channel members:", apiError);
      }
    }

    if (recipientIds.length === 0) {
      logger.info("No recipients found");
      return res.status(200).json({ message: "No recipients" });
    }

    // 5. Respond immediately so Stream doesn't retry due to timeout
    res.status(200).json({ success: true, recipients: recipientIds.length });

    // 6. Process notifications + translation asynchronously (after response is sent)
    setImmediate(async () => {
      // Translate and cache on Stream in parallel with notifications
      translateAndCacheMessage(messageId, messageText, recipientIds, senderId);

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
          logger.info(`✅ Sent notification to user ${recipientId}`);
        }
      } catch (bgError) {
        logger.error("❌ Background notification error:", bgError);
      }
    });
  } catch (error) {
    logger.error("❌ Chat webhook error:", error);
    res.status(500).json({ error: error.message });
  }
};
