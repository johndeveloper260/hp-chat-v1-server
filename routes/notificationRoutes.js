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

// In your routes file (e.g., notificationRoutes.js)
router.post("/stream-webhook", async (req, res) => {
  const { event } = req.body;

  // Stream sends 'call.ring' when a user is invited to a call
  if (event && event.type === "call.ring") {
    const callId = event.call_cid; // e.g., "default:12345"
    const callerName = event.user.name || "Someone";
    const members = event.call.members || [];

    // Filter out the caller so we only notify the recipients
    const recipients = members.filter((m) => m.user_id !== event.user.id);

    console.log(`📞 Incoming call webhook for ${recipients.length} users`);

    for (const member of recipients) {
      // Use your existing controller!
      await notificationController.sendCallNotification(
        member.user_id,
        callerName,
        callId,
      );
    }
  }

  res.status(200).send("OK");
});

export default router;
