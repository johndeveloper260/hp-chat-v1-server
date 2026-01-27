// notificationRoutes.js
import express from "express";
import * as notificationController from "../controller/notificationController.js";
import auth from "../middleware/auth.js";

const router = express.Router();

// Save push token
router.post("/push-token", auth, notificationController.savePushToken);

// Send test notification
router.post("/send-test", auth, notificationController.sendTestNotification);

// Delete push token (on logout)
router.post("/remove-token", auth, notificationController.deletePushToken);

router.get("/", auth, notificationController.getMyNotifications);
router.patch("/:notificationId/read", auth, notificationController.markAsRead);

export default router;
