/**
 * Register Routes
 *
 * Every mutating route is guarded by the Zod validate() middleware.
 * Validation failures are forwarded to the global errorHandler as ZodErrors.
 */
import express from "express";
import { validate } from "../middleware/validate.js";
import {
  validateCodeSchema,
  registerSchema,
} from "../validators/registerValidator.js";
import * as registerController from "../controller/registerController.js";

const router = express.Router();

// POST /register/validate-code — check registration code before showing the form
router.post("/validate-code", validate(validateCodeSchema), registerController.validateCode);

// POST /register/registerUser — create a new account
router.post("/registerUser", validate(registerSchema), registerController.registerUser);

export default router;
