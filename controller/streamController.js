const { StreamClient } = require("@stream-io/node-sdk"); // Use the Node SDK

const apiKey = process.env.STREAM_API_KEY;
const apiSecret = process.env.STREAM_API_SECRET;

const getStreamToken = async (req, res) => {
  const { userId } = req.params; // Or get it from your auth middleware

  try {
    const client = new StreamClient(apiKey, apiSecret);

    // Create a token that expires in 1 hour
    const validity = Math.floor(Date.now() / 1000) + 60 * 60;
    const token = client.generateUserToken({
      user_id: userId,
      validity: validity,
    });

    res.json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).send("Failed to generate Stream token");
  }
};

module.exports = { getStreamToken };
