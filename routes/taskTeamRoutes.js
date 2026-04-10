/**
 * Task Team Routes
 * Mounted at /tasks/teams via taskRoutes.js
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createTeamSchema,
  updateTeamSchema,
  addMemberSchema,
} from "../validators/taskValidator.js";
import {
  listTeams,
  getTeam,
  createTeam,
  updateTeam,
  deleteTeam,
  addMember,
  removeMember,
} from "../controller/taskTeamController.js";

const router = express.Router();

router.get("/",                       auth, listTeams);
router.get("/:id",                    auth, getTeam);
router.post("/",                      auth, validate(createTeamSchema),  createTeam);
router.patch("/:id",                  auth, validate(updateTeamSchema),  updateTeam);
router.delete("/:id",                 auth, deleteTeam);
router.post("/:id/members",           auth, validate(addMemberSchema),   addMember);
router.delete("/:id/members/:userId", auth, removeMember);

export default router;
