/**
 * Access Routes
 *
 * All mutation endpoints are guarded by Zod validate() middleware.
 * Every endpoint requires the role_management_write permission.
 */
import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { assignRoleSchema, replaceRolesSchema } from "../validators/accessValidator.js";
import {
  getUsers,
  getAllRoleDefinitions,
  getUserRoles,
  assignRole,
  revokeRole,
  replaceUserRoles,
} from "../controller/accessController.js";

const router = express.Router();
const RM = requireRole("role_management_write");

// ── Reads ─────────────────────────────────────────────────────────────────────
router.get("/users",             auth, RM, getUsers);
router.get("/roles/definitions", auth, RM, getAllRoleDefinitions);
router.get("/roles/:userId",     auth, RM, getUserRoles);

// ── Mutations ─────────────────────────────────────────────────────────────────
router.post(  "/roles/:userId",           auth, RM, validate(assignRoleSchema),  assignRole);
router.delete("/roles/:userId/:roleName", auth, RM,                              revokeRole);
router.put(   "/roles/:userId",           auth, RM, validate(replaceRolesSchema), replaceUserRoles);

export default router;
