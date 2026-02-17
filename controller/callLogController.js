import { StreamChat } from "stream-chat";

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

/**
 * Format duration in seconds to MM:SS
 */
const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

/**
 * Send a call log message to the DM channel between two users.
 *
 * Looks up the "messaging" channel that contains exactly those two members.
 * Posts a system-like message with custom data (type: "call_log").
 *
 * @param {object} options
 * @param {"missed_call"|"call_summary"} options.callLogType
 * @param {string} options.callerId     - user ID who initiated the call
 * @param {string} options.callerName   - display name of caller
 * @param {string[]} options.memberIds  - all member user IDs on the call
 * @param {number} [options.duration]   - call duration in seconds (for call_summary)
 * @param {string} [options.callType]   - "audio" | "video"
 * @param {string[]} [options.participants] - user names that participated
 */
export const sendCallLogMessage = async ({
  callLogType,
  callerId,
  callerName,
  memberIds,
  duration = 0,
  callType = "audio",
  participants = [],
}) => {
  try {
    // Find the DM channel between these members
    const filters = {
      type: "messaging",
      members: { $eq: memberIds.sort() },
    };

    const channels = await streamClient.queryChannels(filters, {}, { limit: 1 });

    if (!channels || channels.length === 0) {
      console.warn(
        `[CallLog] No channel found between members: ${memberIds.join(", ")}`,
      );
      return { success: false, error: "No channel found" };
    }

    const channel = channels[0];

    // Build the message text and custom data
    let text;
    const customData = {
      call_log_type: callLogType,
      call_type: callType,
      caller_id: callerId,
      caller_name: callerName,
      participants,
    };

    if (callLogType === "missed_call") {
      text = `📞 Missed call from ${callerName}`;
    } else {
      text = `📞 Call Ended · Duration: ${formatDuration(duration)}`;
      customData.call_duration = duration;
      customData.call_duration_formatted = formatDuration(duration);
    }

    // Send as a system message using the server-side client
    // user_id is required for sendMessage on server side — use the caller
    const messageResponse = await channel.sendMessage({
      text,
      user_id: callerId,
      type: "regular",
      call_log: true,
      call_log_data: customData,
      silent: false,
    });

    console.log(
      `✅ [CallLog] Sent ${callLogType} message to channel ${channel.id}`,
    );

    return { success: true, messageId: messageResponse.message?.id };
  } catch (error) {
    console.error(`❌ [CallLog] Failed to send ${callLogType} message:`, error);
    return { success: false, error: error.message };
  }
};
