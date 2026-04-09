import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createSouserSchema, updateSouserSchema, resetSouserPasswordSchema, updateSouserSelfSchema } from "../validators/souserValidator.js";
import {
  getSousers,
  getSouserById,
  getSouserSelf,
  createSouser,
  updateSouser,
  deleteSouser,
  toggleSouserActive,
  grantBuAccess,
  revokeBuAccess,
  updateBuAccessPermissions,
  resetSouserPassword,
  updateSouserSelf,
} from "../controller/souserController.js";

const router = express.Router();

// ── self-service (souser updating their own profile) ─────────────────────────
router.get(  "/me", auth, getSouserSelf);
router.patch("/me", auth, validate(updateSouserSelfSchema), updateSouserSelf);

// ── souser_read ────────────────────────────────────────────────────────────────
router.get("/list",  auth, requireRole("souser_read"), getSousers);
router.get("/:id",   auth, requireRole("souser_read"), getSouserById);

// ── souser_write ───────────────────────────────────────────────────────────────
router.post(  "/create",         auth, requireRole("souser_write"), validate(createSouserSchema), createSouser);
router.patch( "/:id",                   auth, requireRole("souser_write"), validate(updateSouserSchema), updateSouser);
router.patch( "/:id/reset-password",   auth, requireRole("souser_write"), validate(resetSouserPasswordSchema), resetSouserPassword);
router.patch( "/:id/toggle",           auth, requireRole("souser_write"), toggleSouserActive);
router.post(  "/:id/bu-access",  auth, requireRole("souser_write"), grantBuAccess);
router.patch( "/:id/bu-access/:bu/permissions", auth, requireRole("souser_write"), updateBuAccessPermissions);
router.delete("/:id/bu-access/:bu", auth, requireRole("souser_write"), revokeBuAccess);
router.delete("/:id",               auth, requireRole("souser_write"), deleteSouser);

export default router;
