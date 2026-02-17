import express from "express";
import * as notificationController from "../controller/notificationController.js";
import { sendCallLogMessage } from "../controller/callLogController.js";
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

// ─── In-memory call tracking for missed-call detection ───
// Maps callId → { callerId, callerName, memberIds, createdAt, accepted }
const activeCalls = new Map();

// Clean up stale calls older than 5 minutes
const CALL_TTL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, data] of activeCalls) {
    if (now - data.createdAt > CALL_TTL_MS) {
      activeCalls.delete(id);
    }
  }
}, 60_000);

// Stream webhook
router.post("/stream-webhook", async (req, res) => {
  const event = req.body;

  try {
    // ─── Handle call.ring event (primary) ───
    if (event && event.type === "call.ring") {
      const callCid = event.call_cid;
      const callId = callCid?.split(":")[1];
      const callerId = event.user?.id;
      const callerName = event.user?.name || "Someone";
      const callerImage = event.user?.image;

      const members = event.members || event.call?.members || [];
      const recipients = members.filter((m) => m.user_id !== callerId);
      const allMemberIds = members.map((m) => m.user_id).filter(Boolean);

      // Track this call for missed-call detection
      if (callId) {
        activeCalls.set(callId, {
          callerId,
          callerName,
          memberIds: allMemberIds,
          createdAt: Date.now(),
          accepted: false,
        });
      }

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

    // ─── Handle call.created as fallback (when ring: true is set) ───
    if (event && event.type === "call.created" && event.call?.ring) {
      const callCid = event.call_cid;
      const callId = callCid?.split(":")[1];
      const createdBy = event.call?.created_by;
      const callerId = createdBy?.id;
      const callerName = createdBy?.name || "Someone";
      const callerImage = createdBy?.image;

      const members = event.call?.members || [];
      const recipients = members.filter((m) => m.user_id !== callerId);
      const allMemberIds = members.map((m) => m.user_id).filter(Boolean);

      // Track this call if not already tracked by call.ring
      if (callId && !activeCalls.has(callId)) {
        activeCalls.set(callId, {
          callerId,
          callerName,
          memberIds: allMemberIds,
          createdAt: Date.now(),
          accepted: false,
        });
      }

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

    // ─── Handle call.accepted — mark the call as accepted ───
    if (event && event.type === "call.accepted") {
      const callCid = event.call_cid;
      const callId = callCid?.split(":")[1];
      if (callId && activeCalls.has(callId)) {
        activeCalls.get(callId).accepted = true;
        console.log(`📞 [CallLog] Call ${callId} accepted`);
      }
    }

    // ─── Handle call.session_ended — determine missed vs. completed call ───
    if (
      event &&
      (event.type === "call.session_ended" || event.type === "call.ended")
    ) {
      const callCid = event.call_cid;
      const callId = callCid?.split(":")[1];
      const callData = event.call;

      // Extract call info
      const createdBy = callData?.created_by;
      const callerId = createdBy?.id;
      const callerName = createdBy?.name || "Someone";
      const members = callData?.members || [];
      const allMemberIds = members.map((m) => m.user_id).filter(Boolean);

      // Determine call duration from session
      const session = callData?.session;
      let durationSeconds = 0;
      if (session?.started_at && session?.ended_at) {
        const start = new Date(session.started_at).getTime();
        const end = new Date(session.ended_at).getTime();
        durationSeconds = Math.max(0, Math.floor((end - start) / 1000));
      }

      // Check if participants actually joined (i.e. call was answered)
      const participantCount = session?.participants?.length || 0;
      const trackedCall = activeCalls.get(callId);
      const wasAccepted = trackedCall?.accepted || participantCount > 1;

      // Build participant name list
      const participantNames = (session?.participants || [])
        .map((p) => p.user?.name || p.user_session_id)
        .filter(Boolean);

      // Determine if video was used
      const callType =
        session?.participants?.some((p) => p.published_tracks?.includes("VIDEO"))
          ? "video"
          : "audio";

      // Use tracked memberIds if available (more reliable), else fall from call data
      const memberIds =
        trackedCall?.memberIds?.length > 0
          ? trackedCall.memberIds
          : allMemberIds;

      if (memberIds.length >= 2) {
        if (wasAccepted && durationSeconds > 0) {
          // ── Call Summary (completed call) ──
          await sendCallLogMessage({
            callLogType: "call_summary",
            callerId: callerId || trackedCall?.callerId,
            callerName: callerName || trackedCall?.callerName || "Someone",
            memberIds,
            duration: durationSeconds,
            callType,
            participants: participantNames,
          });
        } else {
          // ── Missed Call ──
          await sendCallLogMessage({
            callLogType: "missed_call",
            callerId: callerId || trackedCall?.callerId,
            callerName: callerName || trackedCall?.callerName || "Someone",
            memberIds,
            callType,
            participants: [],
          });
        }
      }

      // Clean up tracked call
      if (callId) {
        activeCalls.delete(callId);
      }
    }
  } catch (err) {
    console.error("❌ [CallLog] Webhook handler error:", err);
  }

  res.status(200).send("OK");
});

export default router;
