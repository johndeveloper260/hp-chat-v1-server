import express from "express";
import auth from "../middleware/auth.js";
import { requireOfficer } from "../middleware/requireRole.js";
import {
  getAllRoleDefinitions,
  getUserRoles,
  assignRole,
  revokeRole,
  replaceUserRoles,
} from "../controller/accessController.js";

const router = express.Router();

/**
 * GET /access/roles/definitions
 * All 16 role definition entries — used to render the permission grid in the UI.
 * Officer+ only (they manage other officers' roles).
 */
router.get("/roles/definitions", auth, requireOfficer, getAllRoleDefinitions);

/**
 * GET /access/roles/:userId
 * Fetch roles assigned to a specific user.
 */
router.get("/roles/:userId", auth, requireOfficer, getUserRoles);

/**
 * POST /access/roles/:userId
 * Grant a single role.  Body: { role_name }
 */
router.post("/roles/:userId", auth, requireOfficer, assignRole);

/**
 * DELETE /access/roles/:userId/:roleName
 * Revoke a single role.
 */
router.delete("/roles/:userId/:roleName", auth, requireOfficer, revokeRole);

/**
 * PUT /access/roles/:userId
 * Atomic full replacement of all roles.  Body: { roles: [] }
 */
router.put("/roles/:userId", auth, requireOfficer, replaceUserRoles);

export default router;
