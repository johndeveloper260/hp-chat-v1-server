/**
 * Profile Controller — thin HTTP adapter
 *
 * Each handler: parse req → call profileService → send res → next(err) on failure.
 * S3, Stream sync, and BU-guard logic live in profileService.
 */
import * as profileService from "../services/profileService.js";
import { getApiMessage }   from "../utils/notificationTranslations.js";

const lang = (req) => req.user?.preferred_language || "en";

// ── Public ────────────────────────────────────────────────────────────────────

/** Avatar proxy — no auth. Returns a 302 redirect to a fresh S3 presigned URL. */
export const getUserAvatar = async (req, res, next) => {
  try {
    const signedUrl = await profileService.getUserAvatarUrl(req.params.userId);
    return res.redirect(302, signedUrl);
  } catch (err) { next(err); }
};

// ── All authenticated users ───────────────────────────────────────────────────

export const getUserProfile = async (req, res, next) => {
  try {
    const profile = await profileService.getUserProfile(
      req.params.userId,
      req.user.business_unit,
      req.user.id,
    );
    res.json(profile);
  } catch (err) { next(err); }
};

export const updateUserProfile = async (req, res, next) => {
  try {
    const data = await profileService.updateUserProfile(
      req.params.userId,
      req.body,
      req.user.business_unit,
    );
    res.json({ message: getApiMessage("update_success", lang(req)), data });
  } catch (err) { next(err); }
};

export const getUserLegalProfile = async (req, res, next) => {
  try {
    const profile = await profileService.getLegalProfile(
      req.params.userId,
      req.user.business_unit,
    );
    res.status(200).json(profile);
  } catch (err) { next(err); }
};

export const updateWorkVisa = async (req, res, next) => {
  try {
    await profileService.updateWorkVisa(
      req.params.userId,
      req.body,
      req.user.business_unit,
    );
    res.status(200).json({ message: getApiMessage("update_success", lang(req)) });
  } catch (err) { next(err); }
};

export const updateUserLanguage = async (req, res, next) => {
  try {
    await profileService.updateUserLanguage(req.user.id, req.body.language);
    res.json({ success: true, message: getApiMessage("update_success", lang(req)) });
  } catch (err) { next(err); }
};

// ── profile_read ──────────────────────────────────────────────────────────────

export const searchUsers = async (req, res, next) => {
  try {
    const rows = await profileService.searchUsers(req.user, req.query);
    res.status(200).json(rows);
  } catch (err) { next(err); }
};

// ── profile_write ─────────────────────────────────────────────────────────────

export const toggleUserActive = async (req, res, next) => {
  try {
    const result = await profileService.toggleUserActive(
      req.params.userId,
      req.user.id,
      req.user.business_unit,
    );
    res.json(result);
  } catch (err) { next(err); }
};
