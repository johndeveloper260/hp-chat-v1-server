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

    // ✅ FIX: Extract just the ID portion from call_cid
    const callCid = event.call_cid; // e.g., "default:abc123"
    const callId = callCid.split(":")[1]; // Extract "abc123"

    const callerId = event.user?.id; // ✅ FIX: Get caller's ID
    const callerName = event.user?.name || "Someone";
    const callerImage = event.user?.image;

    const members = event.call?.members || [];
    const recipients = members.filter((m) => m.user_id !== callerId);

    console.log(`📤 Sending notifications to ${recipients.length} recipients`);

    for (const member of recipients) {
      console.log(`  → Notifying user ${member.user_id}`);

      // ✅ FIX: Now passing all 4 required parameters
      await notificationController.sendCallNotification(
        member.user_id, // recipientUserId
        callerName, // callerName
        callId, // callId (just the ID, not full CID)
        callerId, // callerId ✅ ADDED!
        callerImage, // Optional: for future use
      );
    }
  }

  res.status(200).send("OK");
});

export default router;
