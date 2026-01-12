// routes/commentRoutes.js
import express from "express";
import {
  getComments,
  addComment,
  editComment,
  deleteComment,
  toggleReaction,
} from "../controller/commentsController.js"; // Explicit named imports
import auth from "../middleware/auth.js";

const router = express.Router();

// Line 8 - This is where your error was!
router.get("/:type/:id", auth, getComments);

router.post("/", auth, addComment);
router.put("/:commentId", auth, editComment);
router.delete("/:commentId", auth, deleteComment);
router.post("/react", auth, toggleReaction);

export default router;
