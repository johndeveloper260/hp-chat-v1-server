/**
 * Feed (Announcement) Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/feedService.js.
 *
 * Cross-controller dependencies resolved:
 *   sendNotificationToMultipleUsers → notificationService  (via feedService)
 *   deleteFromS3                    → utils/s3Client        (via feedService)
 */
import * as feedService from "../services/feedService.js";

// ─── Posters ──────────────────────────────────────────────────────────────────

export const getPosters = async (req, res, next) => {
  try {
    const rows = await feedService.getPosters({ businessUnit: req.user.business_unit });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ─── Announcements ────────────────────────────────────────────────────────────

export const getAnnouncements = async (req, res, next) => {
  try {
    const { company_filter, management } = req.query;
    const { id: userId, business_unit: userBU, userType } = req.user;
    const isManagement = management === "true";
    const rows = await feedService.getAnnouncements({ company_filter, userId, userBU, userType, isManagement });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const createAnnouncement = async (req, res, next) => {
  try {
    const { id: userId, business_unit: userBU } = req.user;
    const announcement = await feedService.createAnnouncement({ body: req.body, userId, userBU });
    res.status(201).json(announcement);
  } catch (err) {
    next(err);
  }
};

export const updateAnnouncement = async (req, res, next) => {
  try {
    const { rowId } = req.params;
    const { id: userId, business_unit: userBU } = req.user;
    const updated = await feedService.updateAnnouncement({ rowId, body: req.body, userId, userBU });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteAnnouncement = async (req, res, next) => {
  try {
    await feedService.deleteAnnouncement({
      rowId: req.params.rowId,
      userBU: req.user.business_unit,
    });
    res.json({ success: true, message: "Announcement and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// ─── Reactions ────────────────────────────────────────────────────────────────

export const toggleReaction = async (req, res, next) => {
  try {
    const { rowId } = req.params;
    const { emoji } = req.body;
    const { id: userId, business_unit: userBU } = req.user;
    const result = await feedService.toggleReaction({ rowId, emoji, userId, userBU });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getReactions = async (req, res, next) => {
  try {
    const list = await feedService.getReactions({
      rowId: req.params.rowId,
      userBU: req.user.business_unit,
    });
    res.json(list);
  } catch (err) {
    next(err);
  }
};

// ─── Companies / Batches / Audience ──────────────────────────────────────────

export const getCompaniesWithUsers = async (req, res, next) => {
  try {
    const rows = await feedService.getCompaniesWithUsers({
      userId: req.user.id,
      businessUnit: req.user.business_unit,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const getBatchesByCompany = async (req, res, next) => {
  try {
    const rows = await feedService.getBatchesByCompany({
      companyId: req.params.companyId,
      userBU:    req.user.business_unit,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const previewAudience = async (req, res, next) => {
  try {
    const result = await feedService.previewAudience({
      company:      req.body.company,
      batch_no:     req.body.batch_no,
      businessUnit: req.user.business_unit,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ─── Views ────────────────────────────────────────────────────────────────────

export const markAsSeen = async (req, res, next) => {
  try {
    await feedService.markAsSeen({
      rowId:  req.params.rowId,
      userId: req.user.id,
      userBU: req.user.business_unit,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const getViewers = async (req, res, next) => {
  try {
    const rows = await feedService.getViewers({
      rowId:  req.params.rowId,
      userId: req.user.id,
      userBU: req.user.business_unit,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};
