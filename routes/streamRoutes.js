const express = require("express");
const router = express.Router();
const { getStreamToken } = require("../controller/streamController");
const auth = require("../middleware/auth");

router.get("/token/:userId", auth, getStreamToken);

module.exports = router;
