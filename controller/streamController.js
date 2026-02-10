import { StreamClient } from "@stream-io/node-sdk";
import dotenv from "dotenv";
import { getPool } from "../config/getPool.js";

dotenv.config();

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

/**
 * Generate a Stream Token for a specific user
 */
export const getStreamToken = async (req, res) => {
  const { userId } = req.params;
  const userBU = req.user.business_unit;

  try {
    // Verify the target user belongs to the requestor's business_unit
    const buCheck = await getPool().query(
      "SELECT id FROM v4.user_account_tbl WHERE id = $1::uuid AND business_unit = $2",
      [userId, userBU],
    );
    if (buCheck.rowCount === 0) return res.status(403).json({ error: "Unauthorized" });

    const client = new StreamClient(apiKey, apiSecret);

    // Create a token that expires in 1 hour
    const validity = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = client.generateUserToken({
      user_id: userId,
      validity_period_hs: 3600,
    });

    res.json({ token });
  } catch (err) {
    console.error("Stream Token Error:", err);
    res.status(500).send("Failed to generate Stream token");
  }
};
