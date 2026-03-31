/**
 * Notification Service
 *
 * Provides:
 *  • HTTP-endpoint logic: savePushToken, sendTestNotification, deletePushToken,
 *    getMyNotifications, markAsRead
 *  • Shared service utilities used by other services:
 *    sendNotificationToUser, sendNotificationToMultipleUsers,
 *    createNotification, sendCallNotification
 *
 * The Expo SDK singleton is created once and reused for all sends.
 */
import { Expo }         from "expo-server-sdk";
import * as notifRepo   from "../repositories/notificationRepository.js";
import { getTranslation, translateStatus } from "../utils/notificationTranslations.js";
import { NotFoundError, ValidationError } from "../errors/AppError.js";

const expo = new Expo();

// ── HTTP endpoint business logic ───────────────────────────────────────────────

export const savePushToken = async (userId, businessUnit, expoPushToken) => {
  if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
    throw new ValidationError("invalid_push_token");
  }
  return notifRepo.upsertPushToken(userId, expoPushToken, businessUnit);
};

export const removePushToken = async (userId, businessUnit, expoPushToken) => {
  if (!expoPushToken) {
    throw new ValidationError("push_token_required");
  }
  const deleted = await notifRepo.deletePushToken(userId, expoPushToken, businessUnit);
  if (deleted === 0) throw new NotFoundError("token_not_found");
};

export const getMyNotifications = async (userId, businessUnit) =>
  notifRepo.findUserNotifications(userId, businessUnit);

export const markAsRead = async (notificationId, userId, businessUnit) =>
  notifRepo.markNotificationRead(notificationId, userId, businessUnit);

// ── Shared push helpers (called by commentsService, returnHomeService, etc.) ──

/**
 * Send a push notification to a single user.
 * Returns { success, tickets } or { success: false, error }.
 */
export const sendNotificationToUser = async (
  userId,
  title,
  body,
  data = {},
  businessUnit = null,
) => {
  try {
    const pushToken = await notifRepo.findPushToken(userId, businessUnit);
    if (!pushToken) {
      console.log(`No push token found for user ${userId}`);
      return { success: false, error: "No push token" };
    }
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Invalid push token for user ${userId}`);
      return { success: false, error: "Invalid token" };
    }

    const message = { to: pushToken, sound: "default", title, body, data, badge: 1 };
    const chunks  = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (err) {
        console.error("Error sending notification chunk:", err);
      }
    }

    return { success: true, tickets };
  } catch (error) {
    console.error("sendNotificationToUser error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send a push notification to multiple users.
 * Deduplicates tokens automatically.
 */
export const sendNotificationToMultipleUsers = async (
  userIds,
  title,
  body,
  data = {},
  businessUnit = null,
) => {
  try {
    const rawTokens  = await notifRepo.findPushTokensForUsers(userIds, businessUnit);
    const pushTokens = [...new Set(rawTokens)].filter((t) => Expo.isExpoPushToken(t));

    if (pushTokens.length === 0) {
      console.log("No valid push tokens found");
      return { success: false, error: "No valid tokens" };
    }

    const messages = pushTokens.map((to) => ({
      to, sound: "default", title, body, data, badge: 1,
    }));

    const chunks  = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (err) {
        console.error("Error sending notification chunk:", err);
      }
    }

    return { success: true, tickets, count: tickets.length };
  } catch (error) {
    console.error("sendNotificationToMultipleUsers error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Create and send a translated push notification, then persist to history.
 * Used by commentsService and other domain services.
 */
export const createNotification = async ({
  userId,
  titleKey,
  bodyKey,
  bodyParams = {},
  data,
}) => {
  try {
    const {
      preferred_language: userLanguage,
      business_unit: businessUnit,
      notification: notificationEnabled,
    } = await notifRepo.findUserLangAndBU(userId);

    if (notificationEnabled === false) {
      console.log(`🔕 Notifications disabled for user ${userId}, skipping`);
      return;
    }

    const title = getTranslation(titleKey, userLanguage);
    const finalTitle = data?.rowId ? `#${data.rowId} ${title}` : title;

    let body = getTranslation(bodyKey, userLanguage);
    const translatedParams = { ...bodyParams };
    if (translatedParams.status) {
      translatedParams.status = translateStatus(translatedParams.status, userLanguage);
    }
    Object.keys(translatedParams).forEach((key) => {
      body = body.replace(`{{${key}}}`, translatedParams[key]);
    });

    console.log(`📤 Sending notification in ${userLanguage}:`, { title: finalTitle, body });

    await notifRepo.insertNotificationHistory(
      userId, finalTitle, body, data?.type, data?.rowId, businessUnit,
    );

    return sendNotificationToUser(userId, finalTitle, body, data, businessUnit);
  } catch (err) {
    console.error("createNotification error:", err);
  }
};

/**
 * Send a call-ring push notification with high-priority settings for iOS/Android.
 * Called by the Stream webhook handler in notificationRoutes.js.
 */
export const sendCallNotification = async (
  recipientUserId,
  callerName,
  callId,
  callerId,
  callerImage = null,
) => {
  try {
    const userLanguage  = await notifRepo.findUserLanguage(recipientUserId);
    const recipientBU   = await notifRepo.findUserBusinessUnit(recipientUserId);

    const title        = getTranslation("incoming_call", userLanguage);
    const bodyTemplate = getTranslation("calling_you", userLanguage);
    const body         = `${callerName} ${bodyTemplate}`;

    console.log(`📞 Sending call notification in ${userLanguage}:`, { title, body });

    const pushToken = await notifRepo.findPushToken(recipientUserId, recipientBU);
    if (!pushToken) {
      console.log(`❌ No push token for user ${recipientUserId}`);
      return { success: false, error: "No push token" };
    }
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`❌ Invalid token`);
      return { success: false, error: "Invalid token" };
    }

    const message = {
      to:    pushToken,
      sound: "default",
      title,
      body,
      data: {
        type:          "stream_call",
        callId,
        otherUserId:   callerId,
        otherUserName: callerName,
        otherUserImage: callerImage,
        isIncoming:    true,
        callType:      "default",
        timestamp:     Date.now(),
      },
      priority: "high",
      android: {
        channelId:    "calls",
        priority:     "max",
        sound:        "default",
        vibrate:      [0, 250, 250, 250],
        visibility:   1,
        importance:   5,
        behavior:     "default",
        showTimestamp: true,
      },
      ios: {
        sound:                 "default",
        _displayInForeground:  true,
        interruptionLevel:     "timeSensitive",
        _contentAvailable:     1,
        badge:                 1,
      },
      categoryId: "incoming_call",
    };

    const tickets = await expo.sendPushNotificationsAsync([message]);
    console.log("✅ Call notification sent:", JSON.stringify(tickets, null, 2));
    return { success: true, tickets };
  } catch (error) {
    console.error("❌ sendCallNotification error:", error);
    return { success: false, error: error.message };
  }
};
