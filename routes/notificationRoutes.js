import express from "express";
import * as notificationController from "../controller/notificationController.js";
import auth from "../middleware/auth.js";

const router = express.Router();

// ✅ FIXED: Changed /push-token to /token
router.post("/token", auth, notificationController.savePushToken);

// Send test notification
router.post("/send-test", auth, notificationController.sendTestNotification);

// Delete push token (on logout)
router.post("/remove-token", auth, notificationController.deletePushToken);

// Get notifications
router.get("/", auth, notificationController.getMyNotifications);
router.patch("/:notificationId/read", auth, notificationController.markAsRead);

// Stream webhook
router.post("/stream-webhook", async (req, res) => {
  // console.log("🚀 Webhook Received!");
  // console.log("Event Type:", req.body.type);
  // console.log("Body:", JSON.stringify(req.body, null, 2));

  const event = req.body;

  // Handle call.ring event (primary)
  if (event && event.type === "call.ring") {
    // console.log("📞 RING Event - Incoming Call!");

    const callCid = event.call_cid;
    const callId = callCid.split(":")[1];
    const callerId = event.user?.id;
    const callerName = event.user?.name || "Someone";
    const callerImage = event.user?.image;

    const members = event.members || event.call?.members || [];
    const recipients = members.filter((m) => m.user_id !== callerId);

    // console.log(`📤 Sending notifications to ${recipients.length} recipients`);

    for (const member of recipients) {
      console.log(`  → Notifying user ${member.user_id}`);
      await notificationController.sendCallNotification(
        member.user_id,
        callerName,
        callId,
        callerId,
        callerImage,
      );
    }
  }

  // Handle call.created as fallback (when ring: true is set)
  if (event && event.type === "call.created" && event.call?.ring) {
    // console.log("📞 CREATED Event with ring=true - Sending notifications");

    const callCid = event.call_cid;
    const callId = callCid.split(":")[1];
    const createdBy = event.call?.created_by;
    const callerId = createdBy?.id;
    const callerName = createdBy?.name || "Someone";
    const callerImage = createdBy?.image;

    const members = event.call?.members || [];
    const recipients = members.filter((m) => m.user_id !== callerId);

    // console.log(`📤 Sending notifications to ${recipients.length} recipients`);

    for (const member of recipients) {
      console.log(`  → Notifying user ${member.user_id}`);
      await notificationController.sendCallNotification(
        member.user_id,
        callerName,
        callId,
        callerId,
        callerImage,
      );
    }
  }

  res.status(200).send("OK");
});

export default router;
