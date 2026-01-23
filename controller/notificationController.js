import { getPool } from "../config/getPool.js";
import { Expo } from "expo-server-sdk";

// Create a new Expo SDK client
const expo = new Expo();

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
