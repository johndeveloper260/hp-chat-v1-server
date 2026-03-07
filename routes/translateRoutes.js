/**
 * Translate Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { translateSchema } from "../validators/translateValidator.js";
import { translateText } from "../controller/translateController.js";

const router = express.Router();

router.post("/", auth, validate(translateSchema), translateText);

export default router;
