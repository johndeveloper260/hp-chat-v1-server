/**
 * Task Routes
 * Mounted at /tasks in server.js
 *
 * Sub-routers:
 *   /tasks/columns → taskColumnRoutes
 *   /tasks/teams   → taskTeamRoutes
 *
 * Direct task routes:
 *   GET    /tasks/my-subtasks         — member's assigned sub-tasks (RN App)
 *   GET    /tasks/users/search        — user search for assignee picker (officer)
 *   GET    /tasks
 *   GET    /tasks/:id
 *   POST   /tasks
 *   PATCH  /tasks/:id
 *   PATCH  /tasks/:id/move
 *   PATCH  /tasks/:id/complete        — toggle sub-task completion
 *   DELETE /tasks/:id
 *   POST   /tasks/:id/subtasks        — create sub-task under parent
 *   GET    /tasks/:id/subtasks        — list sub-tasks of parent
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createTaskSchema,
  updateTaskSchema,
  moveTaskSchema,
  createSubtaskSchema,
} from "../validators/taskValidator.js";
import {
  listTasks,
  getTask,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  createSubtask,
  listSubtasks,
  getMySubtasks,
  completeSubtask,
  searchTaskUsers,
} from "../controller/taskController.js";

import columnRoutes from "./taskColumnRoutes.js";
import teamRoutes from "./taskTeamRoutes.js";

const router = express.Router();

// ── Sub-routers ────────────────────────────────────────────────────────────────
router.use("/columns", columnRoutes);
router.use("/teams",   teamRoutes);

// ── Static path routes (must come before /:id to avoid param clash) ───────────
router.get("/my-subtasks",    auth, getMySubtasks);
router.get("/users/search",   auth, searchTaskUsers);

// ── Task CRUD ──────────────────────────────────────────────────────────────────
router.get("/",           auth, listTasks);
router.get("/:id",        auth, getTask);
router.post("/",          auth, validate(createTaskSchema),  createTask);
router.patch("/:id/move",     auth, validate(moveTaskSchema),     moveTask);
router.patch("/:id/complete", auth,                               completeSubtask);
router.patch("/:id",          auth, validate(updateTaskSchema),   updateTask);
router.delete("/:id",         auth, deleteTask);

// ── Sub-task routes ────────────────────────────────────────────────────────────
router.post("/:id/subtasks", auth, validate(createSubtaskSchema), createSubtask);
router.get("/:id/subtasks",  auth, listSubtasks);

export default router;
