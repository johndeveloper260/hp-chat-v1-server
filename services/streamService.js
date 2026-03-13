/**
 * Stream Service
 *
 * Thin wrapper around @stream-io/node-sdk token generation.
 * Keeping this in a service means the controller stays free of SDK imports.
 */
import { StreamClient } from "@stream-io/node-sdk";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";

export const generateStreamToken = (userId) => {
  const client = new StreamClient(env.stream.apiKey, env.stream.apiSecret);
  return client.generateUserToken({
    user_id: String(userId),
    validity_period_hs: env.stream.tokenValidityHours,
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
