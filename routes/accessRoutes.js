import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import {
  getUsers,
  getAllRoleDefinitions,
  getUserRoles,
  assignRole,
  revokeRole,
  replaceUserRoles,
} from "../controller/accessController.js";

const router = express.Router();

/**
 * GET /access/users?search=
 * List active users for the Role Management UI.
 * Requires: role_management_write
 */
router.get("/users", auth, requireRole("role_management_write"), getUsers);

/**
 * GET /access/roles/definitions
 * All available role definition entries — used to render the permission grid.
 * Requires: role_management_write
 */
router.get("/roles/definitions", auth, requireRole("role_management_write"), getAllRoleDefinitions);

/**
 * GET /access/roles/:userId
 * Fetch roles assigned to a specific user.
 * Requires: role_management_write
 */
router.get("/roles/:userId", auth, requireRole("role_management_write"), getUserRoles);

/**
 * POST /access/roles/:userId
 * Grant a single role.  Body: { role_name }
 * Requires: role_management_write
 */
router.post("/roles/:userId", auth, requireRole("role_management_write"), assignRole);

/**
 * DELETE /access/roles/:userId/:roleName
 * Revoke a single role.
 * Requires: role_management_write
 */
router.delete("/roles/:userId/:roleName", auth, requireRole("role_management_write"), revokeRole);

/**
 * PUT /access/roles/:userId
 * Atomic full replacement of all roles.  Body: { roles: [] }
 * Requires: role_management_write
 */
router.put("/roles/:userId", auth, requireRole("role_management_write"), replaceUserRoles);

export default router;
