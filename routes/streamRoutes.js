import express from "express";
import auth from "../middleware/auth.js";

const router = express.Router();

// 1. Change require to a named import and add the .js extension
import { getStreamToken } from "../controller/streamController.js";

// @route   GET /stream/token/:userId
// @desc    Generate a Stream Chat token for a user
router.get("/token/:userId", auth, getStreamToken);

// 2. Change module.exports to export default
export default router;
