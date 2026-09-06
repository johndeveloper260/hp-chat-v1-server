/**
 * Stream Service
 *
 * Thin wrapper around @stream-io/node-sdk token generation.
 * Keeping this in a service means the controller stays free of SDK imports.
 */
import { StreamClient } from "@stream-io/node-sdk";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";
import { ForbiddenError } from "../errors/AppError.js";

export const generateStreamToken = (userId) => {
  const client = new StreamClient(env.stream.apiKey, env.stream.apiSecret);
  return client.generateUserToken({
    user_id: String(userId),
    // The SDK only understands validity_in_seconds — any other key is ignored
    // and the token silently falls back to the 1-hour default.
    validity_in_seconds: env.stream.tokenValidityHours * 3600,
  });
};

let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) {
    _streamChat = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamChat;
};

/**
 * Add a user to a channel using the server-side admin client,
 * bypassing any channel-level permission restrictions.
 */
export const addChannelMember = async (channelId, userId) => {
  const channel = getStreamChat().channel("messaging", channelId);
  await channel.addMembers([String(userId)]);
};

/**
 * Throws unless `userId` is already a member of the channel.
 *
 * Adding someone to a channel is a privileged action performed with the admin
 * client, so the caller has to have standing in that channel — otherwise the
 * endpoint lets an outsider inject members into a conversation they cannot see.
 */
export const assertChannelMember = async (channelId, userId) => {
  const channel = getStreamChat().channel("messaging", String(channelId));
  const { members = [] } = await channel.queryMembers(
    { user_id: { $eq: String(userId) } },
    {},
    { limit: 1 },
  );
  if (members.length === 0) {
    throw new ForbiddenError("chat_not_channel_member", "api_errors.chat.not_channel_member");
  }
};
