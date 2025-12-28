const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const { registerUser } = require("../controller/registerController");

//Public
router.post(`/registerUser`, registerUser);

module.exports = router;
