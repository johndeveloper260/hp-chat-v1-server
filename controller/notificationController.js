import { getPool } from "../config/getPool.js";
import { Expo } from "expo-server-sdk";
import { getTranslation } from "../utils/notificationTranslations.js";

// Create a new Expo SDK client
const expo = new Expo();

/**
 * Helper: Get user's preferred language
 */
const getUserLanguage = async (userId) => {
  try {
    const result = await getPool().query(
      "SELECT preferred_language FROM v4.user_account_tbl WHERE id = $1",
      [userId],
    );
    return result.rows[0]?.preferred_language || "en";
  } catch (error) {
    console.error("Error getting user language:", error);
    return "en"; // Default to English
  }
};

/**
 * Save user's Expo Push Token
 */
export const savePushToken = async (req, res) => {
  const { expoPushToken } = req.body;
  const userId = req.user.id; // From auth middleware

  if (!expoPushToken || !Expo.isExpoPushToken(expoPushToken)) {
    return res.status(400).json({ error: "Invalid Expo Push Token" });
  }

  try {
    // Update or insert push token for user
    const query = `
      INSERT INTO v4.user_push_tokens (user_id, expo_push_token, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (user_id) 
      DO UPDATE SET 
        expo_push_token = $2,
        updated_at = NOW()
      RETURNING *;
    `;

    const result = await getPool().query(query, [userId, expoPushToken]);

    res.json({
      message: "Push token saved successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Save Push Token Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Send push notification to specific user
 */
export const sendNotificationToUser = async (
  userId,
  title,
  body,
  data = {},
) => {
  try {
    // Get user's push token from database
    const result = await getPool().query(
      "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = $1",
      [userId],
    );

    if (result.rows.length === 0) {
      console.log(`No push token found for user ${userId}`);
      return { success: false, error: "No push token" };
    }

    const pushToken = result.rows[0].expo_push_token;

    console.log("Received token:", pushToken);

    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Invalid push token for user ${userId}`);
      return { success: false, error: "Invalid token" };
    }

    // Create the message
    const message = {
      to: pushToken,
      sound: "default",
      title: title,
      body: body,
      data: data,
      badge: 1,
    };

    // Send the notification
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("Error sending notification chunk:", error);
      }
    }

    console.log("Notification sent:", tickets);
    return { success: true, tickets };
  } catch (error) {
    console.error("Send Notification Error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * Send push notification to multiple users
 */
export const sendNotificationToMultipleUsers = async (
  userIds,
  title,
  body,
  data = {},
) => {
  try {
    // Get all push tokens for the users
    const result = await getPool().query(
      "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = ANY($1)",
      [userIds],
    );

    const pushTokens = [
      ...new Set(result.rows.map((row) => row.expo_push_token)),
    ].filter((token) => Expo.isExpoPushToken(token));

    if (pushTokens.length === 0) {
      console.log("No valid push tokens found");
      return { success: false, error: "No valid tokens" };
    }

    // Create messages
    const messages = pushTokens.map((pushToken) => ({
      to: pushToken,
      sound: "default",
      title: title,
      body: body,
      data: data,
      badge: 1,
    }));

    // Send notifications in chunks
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error("Error sending notification chunk:", error);
      }
    }

    console.log(`Sent ${tickets.length} notifications`);
    return { success: true, tickets, count: tickets.length };
  } catch (error) {
    console.error("Send Multiple Notifications Error:", error);
    return { success: false, error: error.message };
  }
};

/**
 * API Endpoint: Send notification (for testing)
 */
export const sendTestNotification = async (req, res) => {
  const { userId, title, body, data } = req.body;

  if (!userId || !title || !body) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const result = await sendNotificationToUser(userId, title, body, data);

    if (result.success) {
      res.json({ message: "Notification sent successfully", data: result });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error) {
    console.error("Test Notification Error:", error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /notifications/remove-token
 * Removes a specific push token from the database on logout
 */
export const deletePushToken = async (req, res) => {
  const userId = req.user.id;
  const { expoPushToken } = req.body;

  if (!expoPushToken) {
    return res.status(400).json({ error: "Push token is required" });
  }

  try {
    // We filter by both token and userId for security
    const result = await getPool().query(
      "DELETE FROM v4.user_push_tokens WHERE user_id = $1 AND expo_push_token = $2",
      [userId, expoPushToken],
    );

    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ message: "Token not found or already removed" });
    }

    res.json({ success: true, message: "Push token removed successfully" });
  } catch (error) {
    console.error("Delete Push Token Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Add these to your existing notificationController.js

/**
 * Updated: createNotification with language support
 */
export const createNotification = async ({
  userId,
  titleKey,
  bodyKey,
  bodyParams = {},
  data,
}) => {
  try {
    // 1. Get user's language preference
    const userLanguage = await getUserLanguage(userId);

    // 2. Translate title and body
    const title = getTranslation(titleKey, userLanguage);

    // Concat the ID to the title
    const finalTitle = data?.rowId ? `#${data.rowId} ${title}` : title;

    let body = getTranslation(bodyKey, userLanguage);

    // 3. Replace parameters in body (like {{name}})
    Object.keys(bodyParams).forEach((key) => {
      body = body.replace(`{{${key}}}`, bodyParams[key]);
    });

    console.log(`📤 Sending notification in ${userLanguage}:`, { title, body });

    // 4. Save to Database
    const dbQuery = `
      INSERT INTO v4.notification_history_tbl 
      (user_id, title, body, relation_type, relation_id)
      VALUES ($1, $2, $3, $4, $5)
    `;
    await getPool().query(dbQuery, [
      userId,
      finalTitle,
      body,
      data?.type,
      data?.rowId,
    ]);

    // 5. Send Push Notification
    return await sendNotificationToUser(userId, title, body, data);
  } catch (err) {
    console.error("Error creating notification:", err);
  }
};

/**
 * GET: Fetch notifications for the logged-in user
 */
export const getMyNotifications = async (req, res) => {
  const userId = req.user.id;
  try {
    const query = `
    SELECT * FROM v4.notification_history_tbl 
    WHERE user_id = $1 
    AND is_read = false 
    ORDER BY created_at DESC 
    LIMIT 50
    `;
    const { rows } = await getPool().query(query, [userId]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * PATCH: Mark as read
 */
export const markAsRead = async (req, res) => {
  const { notificationId } = req.params;
  const userId = req.user.id;
  try {
    await getPool().query(
      "UPDATE v4.notification_history_tbl SET is_read = true WHERE notification_id = $1 AND user_id = $2",
      [notificationId, userId],
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * Updated: sendCallNotification with language support
 */
export const sendCallNotification = async (
  recipientUserId,
  callerName,
  callId,
  callerId,
  callerImage = null,
) => {
  try {
    // Get user's language
    const userLanguage = await getUserLanguage(recipientUserId);

    // Translate
    const title = getTranslation("incoming_call", userLanguage);
    const bodyTemplate = getTranslation("calling_you", userLanguage);
    const body = `${callerName} ${bodyTemplate}`;

    console.log(`📞 Sending call notification in ${userLanguage}:`, {
      title,
      body,
    });

    const result = await getPool().query(
      "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = $1",
      [recipientUserId],
    );

    if (result.rows.length === 0) {
      console.log(`❌ No push token for user ${recipientUserId}`);
      return { success: false, error: "No push token" };
    }

    const pushToken = result.rows[0].expo_push_token;

    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`❌ Invalid token`);
      return { success: false, error: "Invalid token" };
    }

    const message = {
      to: pushToken,
      sound: "default",
      title: title,
      body: body,
      data: {
        type: "stream_call",
        callId: callId,
        otherUserId: callerId,
        otherUserName: callerName,
        otherUserImage: callerImage,
        isIncoming: true,
        callType: "default",
        timestamp: Date.now(),
      },
      priority: "high",
      android: {
        channelId: "calls",
        priority: "max",
        sound: "default",
        vibrate: [0, 250, 250, 250],
        visibility: 1,
        importance: 5,
        behavior: "default",
        showTimestamp: true,
      },
      ios: {
        sound: "default",
        _displayInForeground: true,
        interruptionLevel: "timeSensitive",
        _contentAvailable: 1,
        badge: 1,
      },
      categoryId: "incoming_call",
    };

    const tickets = await expo.sendPushNotificationsAsync([message]);
    console.log("✅ Sent:", JSON.stringify(tickets, null, 2));

    return { success: true, tickets };
  } catch (error) {
    console.error("❌ Error:", error);
    return { success: false, error: error.message };
  }
};
