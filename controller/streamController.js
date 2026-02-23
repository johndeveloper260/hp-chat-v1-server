import { StreamClient } from "@stream-io/node-sdk";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

/**
 * Generate a Stream Token for the currently authenticated user.
 *
 * The user ID comes from the verified JWT (req.user.id), not from the URL,
 * so there is no way to spoof a token for another user and no fragile
 * client-side AsyncStorage lookup is needed.
 */
export const getStreamToken = async (req, res) => {
  const userId = req.user.id;

  try {
    const client = new StreamClient(apiKey, apiSecret);

    // Token expires in 24 hours; the mobile SDK's tokenProvider will
    // call this endpoint again automatically before it expires.
    const token = client.generateUserToken({
      user_id: userId,
      validity_period_hs: 24,
    });

    res.json({ token });
  } catch (err) {
    console.error("Stream Token Error:", err);
    res.status(500).send("Failed to generate Stream token");
  }
};
