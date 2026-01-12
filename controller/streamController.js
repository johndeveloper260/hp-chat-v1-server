import { StreamClient } from "@stream-io/node-sdk";
import dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

/**
 * Generate a Stream Token for a specific user
 */
export const getStreamToken = async (req, res) => {
  const { userId } = req.params;

  try {
    const client = new StreamClient(apiKey, apiSecret);

    // Create a token that expires in 1 hour
    const validity = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = client.generateUserToken({
      user_id: userId,
      validity_period_hs: 3600, // Alternatively, you can use validity_period_hs
    });

    res.json({ token });
  } catch (err) {
    console.error("Stream Token Error:", err);
    res.status(500).send("Failed to generate Stream token");
  }
};
