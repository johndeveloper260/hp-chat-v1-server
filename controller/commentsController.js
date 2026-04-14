/**
 * Comments Controller — thin HTTP adapter
 *
 * The previous cross-controller import of createNotification from
 * notificationController is resolved by commentsService importing it
 * directly from notificationService. This controller has no cross-module
 * dependencies beyond its own service.
 */
import * as commentsService from "../services/commentsService.js";

export const getComments = async (req, res, next) => {
  try {
    const { type, id } = req.params;
    const rows = await commentsService.getComments(type, id, req.user.business_unit, req.user.id, req.user.userType);
    res.status(200).json(rows);
  } catch (err) { next(err); }
};

export const addComment = async (req, res, next) => {
  try {
    const newComment = await commentsService.addComment(
      req.body,
      req.user.id,
      req.user.business_unit,
    );
    res.status(201).json(newComment);
  } catch (err) { next(err); }
};

export const editComment = async (req, res, next) => {
  try {
    const updated = await commentsService.editComment(
      req.params.commentId,
      req.body.content_text,
      req.user.id,
      req.user.business_unit,
    );
    res.json(updated);
  } catch (err) { next(err); }
};

export const deleteComment = async (req, res, next) => {
  try {
    await commentsService.deleteComment(
      req.params.commentId,
      req.user.id,
      req.user.business_unit,
      req.user.userType,
    );
    res.json({ message: "Comment deleted successfully", commentId: req.params.commentId });
  } catch (err) { next(err); }
};
