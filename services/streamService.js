/**
 * Stream Service
 *
 * Thin wrapper around @stream-io/node-sdk token generation.
 * Keeping this in a service means the controller stays free of SDK imports.
 */
import { StreamClient } from "@stream-io/node-sdk";
import env from "../config/env.js";

export const generateStreamToken = (userId) => {
  const client = new StreamClient(env.stream.apiKey, env.stream.apiSecret);
  return client.generateUserToken({
    user_id: String(userId),
    validity_period_hs: env.stream.tokenValidityHours,
  });
};
