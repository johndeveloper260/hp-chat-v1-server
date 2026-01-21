import express from "express";
const router = express.Router();

import * as registerController from "../controller/registerController.js";

// Public
router.post(`/registerUser`, registerController.registerUser);
router.post(`/validate-code`, registerController.validateCode);

// CHANGE THIS:
export default router;
