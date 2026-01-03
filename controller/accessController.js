//01-May 2025
//HoRenSo Plus v3

const stream = require("getstream");
const { StreamChat } = require("stream-chat");

const { getPool } = require("../config/getPool");

// @route    Get Access
// @desc     Get Access Details
// @access   Private
exports.getAccess = async (req, res, next) => {
  try {
    // instantiate a new client (server side)
    const client = new StreamChat("gj5tkargz4uc", "", { disableCache: true });

    const channel = client.channel("messaging", "teamOne", {});
    const message = await channel.sendMessage({
      text: "sure. see you soon!",
      user_id: "user3",
    });

    console.log(message);

    const results = await getPool().query(
      `SELECT role_name FROM ultra.access_tbl`,
      []
    );

    return res.status(200).send(results.rows);
  } catch (error) {
    console.error(error.message);
    res.status(500).send("Cannot Get Access");
  }
};
