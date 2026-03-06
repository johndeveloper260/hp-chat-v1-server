import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  searchReturnHome,
  createReturnHome,
  getReturnHomeById,
  updateReturnHome,
  deleteReturnHome,
  approveReturnHome,
} from "../controller/returnHomeController.js";

const router = express.Router();

// ── All authenticated users ───────────────────────────────────────────────────
// Controllers scope to own records for non-officers internally
router.post("/create",       auth, createReturnHome);
router.get("/search",        auth, searchReturnHome);    // controller scopes by role
router.get("/:id",           auth, getReturnHomeById);   // controller verifies ownership
router.put("/update/:id",    auth, updateReturnHome);    // controller verifies ownership

// ── flight_write ──────────────────────────────────────────────────────────────
router.delete("/delete/:id",   auth, requireRole("flight_write"),  deleteReturnHome);
router.patch("/approve/:id",   auth, requireRole("flight_write"),  approveReturnHome);

export default router;
