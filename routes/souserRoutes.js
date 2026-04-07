import express from "express";
import auth from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { validate } from "../middleware/validate.js";
import { createSouserSchema, updateSouserSchema } from "../validators/souserValidator.js";
import {
  getSousers,
  getSouserById,
  createSouser,
  updateSouser,
  toggleSouserActive,
  grantBuAccess,
  revokeBuAccess,
} from "../controller/souserController.js";

const router = express.Router();

// ── souser_read ────────────────────────────────────────────────────────────────
router.get("/list",  auth, requireRole("souser_read"), getSousers);
router.get("/:id",   auth, requireRole("souser_read"), getSouserById);

// ── souser_write ───────────────────────────────────────────────────────────────
router.post(  "/create",         auth, requireRole("souser_write"), validate(createSouserSchema), createSouser);
router.patch( "/:id",            auth, requireRole("souser_write"), validate(updateSouserSchema), updateSouser);
router.patch( "/:id/toggle",     auth, requireRole("souser_write"), toggleSouserActive);
router.post(  "/:id/bu-access",  auth, requireRole("souser_write"), grantBuAccess);
router.delete("/:id/bu-access/:bu", auth, requireRole("souser_write"), revokeBuAccess);

export default router;
