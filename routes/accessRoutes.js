import express from "express";
const router = express.Router();

// 1. Change require to import and add .js extension
import { getAccess } from "../controller/accessController.js";

// @route   GET /access/getAccess
// @desc    Get Access Details
// @access  Private
router.get("/getAccess", getAccess);

// router.post("/getRole", auth, getRole);
// router.post("/addRole", auth, addRole);
// router.post("/deleteRole", auth, deleteRole);

// 2. Change module.exports to export default
export default router;
