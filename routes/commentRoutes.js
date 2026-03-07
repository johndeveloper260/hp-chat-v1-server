/**
 * Comment Routes
 */
import express from "express";
import { getComments, addComment, editComment, deleteComment } from "../controller/commentsController.js";
import auth             from "../middleware/auth.js";
import { validate }     from "../middleware/validate.js";
import { addCommentSchema, editCommentSchema } from "../validators/commentValidator.js";

const router = express.Router();

router.get("/:type/:id",    auth, getComments);
router.post("/",            auth, validate(addCommentSchema),  addComment);
router.put("/:commentId",   auth, validate(editCommentSchema), editComment);
router.delete("/:commentId", auth, deleteComment);

export default router;
