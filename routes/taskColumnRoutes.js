/**
 * Task Column Routes
 * Mounted at /tasks/columns via taskRoutes.js
 */
import express from "express";
import auth from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createColumnSchema,
  updateColumnSchema,
  reorderColumnsSchema,
} from "../validators/taskValidator.js";
import {
  listColumns,
  createColumn,
  updateColumn,
  reorderColumns,
  deleteColumn,
} from "../controller/taskColumnController.js";

const router = express.Router();

router.get("/",          auth, listColumns);
router.post("/",         auth, validate(createColumnSchema),    createColumn);
router.patch("/reorder", auth, validate(reorderColumnsSchema),  reorderColumns);
router.patch("/:id",     auth, validate(updateColumnSchema),    updateColumn);
router.delete("/:id",    auth, deleteColumn);

export default router;
