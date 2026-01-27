import express from "express";
const router = express.Router();

// 1. Use import instead of require
import { translateText } from "../controller/translateController.js";
import auth from "../middleware/auth.js";

// 2. Define the route
router.post("/", auth, translateText);

// 3. Keep the export default
export default router;
