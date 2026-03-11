/**
 * Return Home Routes
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate }    from "../middleware/validate.js";
import {
  createReturnHomeSchema,
  updateReturnHomeSchema,
  approveReturnHomeSchema,
  patchReturnHomeStatusSchema,
} from "../validators/returnHomeValidator.js";
import {
  searchReturnHome,
  createReturnHome,
  getReturnHomeById,
  updateReturnHome,
  patchReturnHomeStatus,
  deleteReturnHome,
  approveReturnHome,
} from "../controller/returnHomeController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
// Controllers scope to own records for non-officers internally
router.post("/create",     auth, validate(createReturnHomeSchema), createReturnHome);
router.get("/search",      auth, searchReturnHome);                       // controller scopes by role
router.get("/:id",         auth, getReturnHomeById);                      // controller verifies BU
router.put("/update/:id",   auth, validate(updateReturnHomeSchema), updateReturnHome);
router.patch("/status/:id", auth, validate(patchReturnHomeStatusSchema), patchReturnHomeStatus);

// ── flight_write ───────────────────────────────────────────────────────────────
router.delete("/delete/:id",  auth, requireRole("flight_write"), deleteReturnHome);
router.patch("/approve/:id",  auth, requireRole("flight_write"), validate(approveReturnHomeSchema), approveReturnHome);

export default router;
