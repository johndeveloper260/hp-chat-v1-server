/**
 * Task Routes
 * Mounted at /tasks in server.js
 *
 * Sub-routers:
 *   /tasks/columns → taskColumnRoutes
 *   /tasks/teams   → taskTeamRoutes
 *
 * Direct task routes:
 *   GET    /tasks
 *   GET    /tasks/:id
 *   POST   /tasks
 *   PATCH  /tasks/:id
 *   PATCH  /tasks/:id/move
 *   DELETE /tasks/:id
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
} from "../validators/taskValidator.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
} from "../controller/taskController.js";

import columnRoutes from "./taskColumnRoutes.js";
import teamRoutes from "./taskTeamRoutes.js";

const router = express.Router();

// ── Sub-routers ────────────────────────────────────────────────────────────────
router.use("/columns", columnRoutes);
router.use("/teams",   teamRoutes);

// ── Task routes ────────────────────────────────────────────────────────────────
router.get("/",           auth, listTasks);
router.get("/:id",        auth, getTask);
router.post("/",          auth, validate(createTaskSchema),  createTask);
router.patch("/:id/move", auth, validate(moveTaskSchema),    moveTask);
router.patch("/:id",      auth, validate(updateTaskSchema),  updateTask);
router.delete("/:id",     auth, deleteTask);

export default router;
