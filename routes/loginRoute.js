const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const { loginUser } = require("../controller/loginController");

//Public
router.post(`/loginUser`, loginUser);

module.exports = router;
