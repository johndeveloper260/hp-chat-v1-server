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

  // We only care when a call is created and users are being "rung"
  if (event.type === "call.ring") {
    const callId = event.call.id;
    const callerName = event.user.name || "Someone";
    const members = event.call.members; // Array of members in the call

    // Find the members who aren't the caller
    const recipients = members.filter((m) => m.user_id !== event.user.id);

    for (const member of recipients) {
      // Use your existing controller to send the push!
      await sendCallNotification(member.user_id, callerName, callId);
    }
  }

  res.status(200).send("Webhook received");
});

export default router;
