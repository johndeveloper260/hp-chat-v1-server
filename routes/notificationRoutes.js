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

// ✅ CHANGE THIS:
// router.post("/notifications/stream-webhook", ... )
// TO THIS:
router.post("/stream-webhook", async (req, res) => {
  console.log("🚀 Webhook Received!");
  console.log("Body:", JSON.stringify(req.body, null, 2));

  const event = req.body;

  // Stream uses a flat structure for webhooks
  if (event && event.type === "call.ring") {
    console.log("📞 Incoming Call Event Found!");
    const callId = event.call_cid;
    const callerName = event.user?.name || "Someone";
    const members = event.call?.members || [];

    const recipients = members.filter((m) => m.user_id !== event.user?.id);

    for (const member of recipients) {
      // This sends the push via Expo
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
