const express = require("express");
const router = express.Router();
const { translateText } = require("../controllers/translateController");

// If you have authentication middleware, you would add it here
import auth from "../middleware/auth.js";

// POST /api/v1/translate
router.post("/", auth, translateText);
// router.post("/", protect, translateText); // Use this if it's a private route

export default router;
