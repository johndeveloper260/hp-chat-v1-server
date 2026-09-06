/**
 * Feed (Announcement) Controller
 *
 * Thin HTTP adapters — parse req → call service → send res → next(err).
 * All business logic lives in services/feedService.js.
 *
 * Handlers pass `req.user` through whole rather than picking fields off it.
 * Authorization needs the caller's full identity — user type, business unit,
 * and for a SOUSER the derived souserScope — and cherry-picking fields is how
 * the scope checks got skipped on the per-record routes in the first place.
 *
 * Cross-controller dependencies resolved:
 *   sendNotificationToMultipleUsers → notificationService  (via feedService)
 *   deleteFromS3                    → utils/s3Client        (via feedService)
 */
import * as feedService from "../services/feedService.js";

// ─── Posters ──────────────────────────────────────────────────────────────────

export const getPosters = async (req, res, next) => {
  try {
    const rows = await feedService.getPosters(req.user);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

// ─── Announcements ────────────────────────────────────────────────────────────

export const getAnnouncements = async (req, res, next) => {
  try {
    const { company_filter, management } = req.query;
    const rows = await feedService.getAnnouncements({
      company_filter,
      user: req.user,
      isManagement: management === "true",
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const createAnnouncement = async (req, res, next) => {
  try {
    const announcement = await feedService.createAnnouncement({
      body: req.body,
      user: req.user,
    });
    res.status(201).json(announcement);
  } catch (err) {
    next(err);
  }
};

export const updateAnnouncement = async (req, res, next) => {
  try {
    const updated = await feedService.updateAnnouncement({
      rowId: req.params.rowId,
      body:  req.body,
      user:  req.user,
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
};

export const deleteAnnouncement = async (req, res, next) => {
  try {
    await feedService.deleteAnnouncement({ rowId: req.params.rowId, user: req.user });
    res.json({ success: true, message: "Announcement and all related data deleted successfully" });
  } catch (err) {
    next(err);
  }
};

// ─── Reactions ────────────────────────────────────────────────────────────────

export const toggleReaction = async (req, res, next) => {
  try {
    const result = await feedService.toggleReaction({
      rowId: req.params.rowId,
      emoji: req.body.emoji,
      user:  req.user,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getReactions = async (req, res, next) => {
  try {
    const list = await feedService.getReactions({ rowId: req.params.rowId, user: req.user });
    res.json(list);
  } catch (err) {
    next(err);
  }
};

// ─── Companies / Batches / Audience ──────────────────────────────────────────

export const getCompaniesWithUsers = async (req, res, next) => {
  try {
    const rows = await feedService.getCompaniesWithUsers(req.user);
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const getBatchesByCompany = async (req, res, next) => {
  try {
    const rows = await feedService.getBatchesByCompany({
      companyId: req.params.companyId,
      user:      req.user,
    });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};

export const previewAudience = async (req, res, next) => {
  try {
    const result = await feedService.previewAudience({
      company:     req.body.company,
      batch_no:    req.body.batch_no,
      country:     req.body.country,
      sending_org: req.body.sending_org,
      user:        req.user,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ─── Favorites ────────────────────────────────────────────────────────────────

export const toggleFavorite = async (req, res, next) => {
  try {
    const result = await feedService.toggleFavorite({ rowId: req.params.rowId, user: req.user });
    res.json(result);
  } catch (err) {
    next(err);
  }
};

// ─── Views ────────────────────────────────────────────────────────────────────

export const markAsSeen = async (req, res, next) => {
  try {
    await feedService.markAsSeen({ rowId: req.params.rowId, user: req.user });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const getViewers = async (req, res, next) => {
  try {
    const rows = await feedService.getViewers({ rowId: req.params.rowId, user: req.user });
    res.json(rows);
  } catch (err) {
    next(err);
  }
};
