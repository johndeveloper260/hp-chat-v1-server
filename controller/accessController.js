import stream from "getstream";
import { StreamChat } from "stream-chat";
import { getPool } from "../config/getPool.js";

export const getAccess = async (req, res, next) => {
  try {
    // 1. Use getInstance instead of 'new'
    // 2. Use environment variables for your key and secret
    const client = StreamChat.getInstance(
      process.env.STREAM_API_KEY || "gj5tkargz4uc",
      process.env.STREAM_API_SECRET
    );

    const channel = client.channel("messaging", "teamOne");

    // Send message as 'user3'
    const message = await channel.sendMessage({
      text: "sure. see you soon!",
      user: { id: "user3" }, // Recommended structure for user
    });

    console.log("Stream Message Sent:", message.id);

    const results = await getPool().query(
      `SELECT role_name FROM ultra.access_tbl`,
      []
    );

    return res.status(200).send(results.rows);
  } catch (error) {
    // Better error logging to help you debug Stream vs Database errors
    console.error("Error in getAccess:", error.message);
    res.status(500).send("Cannot Get Access");
  }
};
