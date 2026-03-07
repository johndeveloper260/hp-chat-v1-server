/**
 * Notification Controller — thin HTTP adapter
 *
 * HTTP endpoints delegate to notificationService.
 *
 * The service-level utility functions (sendNotificationToUser,
 * sendNotificationToMultipleUsers, createNotification, sendCallNotification)
 * are re-exported here for backward compatibility — other route files and
 * controllers that import them from this module continue to work unchanged.
 */
import * as notifService from "../services/notificationService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

// ── HTTP endpoints ─────────────────────────────────────────────────────────────

export const savePushToken = async (req, res, next) => {
  try {
    const data = await notifService.savePushToken(
      req.user.id,
      req.user.business_unit,
      req.body.expoPushToken,
    );
    res.json({ message: getApiMessage("update_success", lang(req)), data });
  } catch (err) { next(err); }
};

export const sendTestNotification = async (req, res, next) => {
  try {
    const { userId, title, body, data } = req.body;
    const result = await notifService.sendNotificationToUser(userId, title, body, data);
    if (result.success) {
      res.json({ message: "Notification sent successfully", data: result });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (err) { next(err); }
};

export const deletePushToken = async (req, res, next) => {
  try {
    await notifService.removePushToken(
      req.user.id,
      req.user.business_unit,
      req.body.expoPushToken,
    );
    res.json({ success: true, message: getApiMessage("delete_success", lang(req)) });
  } catch (err) { next(err); }
};

export const getMyNotifications = async (req, res, next) => {
  try {
    const rows = await notifService.getMyNotifications(
      req.user.id,
      req.user.business_unit,
    );
    res.json(rows);
  } catch (err) { next(err); }
};

export const markAsRead = async (req, res, next) => {
  try {
    await notifService.markAsRead(
      req.params.notificationId,
      req.user.id,
      req.user.business_unit,
    );
    res.json({ success: true });
  } catch (err) { next(err); }
};

// ── Re-exports for backward compatibility ─────────────────────────────────────
// notificationRoutes.js and other modules import these service functions
// directly from this controller — re-exporting keeps those imports valid.

export const sendNotificationToUser         = notifService.sendNotificationToUser;
export const sendNotificationToMultipleUsers = notifService.sendNotificationToMultipleUsers;
export const createNotification             = notifService.createNotification;
export const sendCallNotification           = notifService.sendCallNotification;
