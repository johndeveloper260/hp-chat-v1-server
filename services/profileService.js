/**
 * Profile Service
 *
 * Business logic for user profiles, visa info, avatar, and account status.
 * No req/res references — all errors thrown as AppError subclasses.
 */
import bcrypt from "bcrypt";
import * as profileRepo   from "../repositories/profileRepository.js";
import * as userRepo      from "../repositories/userRepository.js";
import { syncUserToStream } from "../utils/syncUserToStream.js";
import { getUserLanguage }   from "../utils/getUserLanguage.js";
import { getPresignedUrl }   from "../utils/s3Client.js";
import env                   from "../config/env.js";
import { getPool }           from "../config/getPool.js";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors/AppError.js";

const VALID_LANGUAGES = ["en", "ja", "id", "vi"];

// ── BU settings ───────────────────────────────────────────────────────────────

/** Returns live BU feature flags (e.g. lock_screen_expire) for the caller's BU. */
export const getBUSettings = async (businessUnit) => {
  const row = await profileRepo.getBUSettings(businessUnit);
  return {
    lockScreenExpire:     row?.lock_screen_expire      ?? false,
    lockScreenExpireDays: row?.lock_screen_expire_days ?? 14,
    bu_souser_enabled:    row?.souser_enabled           ?? false,
    task_enabled:         row?.task_enabled             ?? false,
    bu_assessment_enabled: row?.assessment_enabled      ?? false,
  };
};

// ── Search users ──────────────────────────────────────────────────────────────

export const searchUsers = async (requestor, filters) => {
  const lang = await getUserLanguage(requestor.id);
  return profileRepo.searchUsers(lang, requestor.business_unit, filters);
};

// ── Work visa ─────────────────────────────────────────────────────────────────

export const updateWorkVisa = async (userId, data, requestorBU) => {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const member = await profileRepo.findUserInBU(userId, requestorBU, client);
    if (!member) {
      await client.query("ROLLBACK");
      throw new ForbiddenError();
    }

    await profileRepo.updateVisaInfo(userId, data, client);
    await client.query("COMMIT");

    // Best-effort Stream sync — never fail the request if this errors
    try { await syncUserToStream(userId); } catch (e) {
      console.error("Stream sync after visa update failed:", e);
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
};

// ── Read profile ──────────────────────────────────────────────────────────────

export const getLegalProfile = async (userId, requestorBU) => {
  const profile = await profileRepo.findLegalProfile(userId, requestorBU);
  if (!profile) throw new NotFoundError("record_not_found");
  return profile;
};

export const getUserProfile = async (userId, requestorBU, requestorId) => {
  const lang    = await getUserLanguage(requestorId);
  const profile = await profileRepo.findUserProfile(userId, requestorBU, lang);
  if (!profile) throw new NotFoundError("record_not_found");
  return profile;
};

// ── Update profile ────────────────────────────────────────────────────────────

export const updateUserProfile = async (userId, data, requestorBU) => {
  const member = await profileRepo.findUserInBU(userId, requestorBU);
  if (!member) throw new ForbiddenError();

  const row = await profileRepo.updateUserProfile(userId, data, requestorBU);
  try { await syncUserToStream(userId); } catch (e) {
    console.error("Stream sync after profile update failed:", e);
  }
  return row;
};

// ── Toggle active ──────────────────────────────────────────────────────────────

export const toggleUserActive = async (userId, officerId, officerBU) => {
  if (String(userId) === String(officerId)) {
    throw new ValidationError(
      "cannot_change_own_status",
      "api_errors.user_mgmt.cannot_change_own_status",
    );
  }

  const current = await profileRepo.findActiveStatus(userId, officerBU);
  if (!current) {
    throw new NotFoundError(
      "user_not_found",
      "api_errors.user_mgmt.user_not_found",
    );
  }

  const newStatus = !current.is_active;
  await profileRepo.setActiveStatus(userId, newStatus);
  return { is_active: newStatus };
};

// ── Admin reset user password ──────────────────────────────────────────────────

/**
 * Officer-initiated password reset for a user in the same business unit.
 * @param {string} targetUserId
 * @param {string} newPassword  - Already validated (min 6 chars) by Zod
 * @param {string} officerBU
 */
export const adminResetUserPassword = async (targetUserId, newPassword, officerBU) => {
  const member = await profileRepo.findUserInBU(targetUserId, officerBU);
  if (!member) throw new ForbiddenError();

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const rowCount = await userRepo.updatePasswordHash(targetUserId, passwordHash);
  if (rowCount === 0) throw new NotFoundError("user_not_found");
};

// ── Language preference ────────────────────────────────────────────────────────

export const updateUserLanguage = async (userId, language) => {
  if (!VALID_LANGUAGES.includes(language)) {
    throw new ValidationError("invalid_language_code");
  }
  await profileRepo.updatePreferredLanguage(userId, language);
};

// ── Notification preference ───────────────────────────────────────────────────

export const updateNotificationPreference = async (userId, value) => {
  if (typeof value !== "boolean") {
    throw new ValidationError("invalid_notification_value");
  }
  await userRepo.updateNotificationPreference(userId, value);
};

// ── Auto-translate chat ───────────────────────────────────────────────────────

export const updateAutoTranslateChat = async (userId, enabled) => {
  if (typeof enabled !== "boolean") {
    throw new ValidationError("invalid_value");
  }
  await profileRepo.updateAutoTranslateChat(userId, enabled);
};

export const updateTranslateExceptions = async (userId, exceptions) => {
  if (!Array.isArray(exceptions)) {
    throw new ValidationError("invalid_value");
  }
  await profileRepo.updateTranslateExceptions(userId, exceptions);
};

// ── Theme preference ──────────────────────────────────────────────────────────

const VALID_THEMES = ["light", "dark", "system"];

export const updateThemePreference = async (userId, theme) => {
  if (!VALID_THEMES.includes(theme)) {
    throw new ValidationError("invalid_theme_value");
  }
  await profileRepo.updateThemePreference(userId, theme);
};

// ── Avatar ────────────────────────────────────────────────────────────────────

// Cache presigned avatar URLs per user. TTL is 55 min; the URL itself expires at 60 min.
const _avatarCache = new Map(); // userId (string) → { url, expiresAt }
const AVATAR_URL_TTL_MS = 55 * 60 * 1000;

/** Evict a user's cached avatar URL — call when their profile picture changes. */
export const clearAvatarCache = (userId) => {
  _avatarCache.delete(String(userId));
};

/**
 * Returns a short-lived presigned S3 URL for the user's latest profile picture.
 * Results are cached in-process for 55 minutes to avoid redundant S3 API calls.
 * Throws NotFoundError if no picture has been uploaded.
 */
export const getUserAvatarUrl = async (userId) => {
  const key = String(userId);
  const cached = _avatarCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.url;

  const row = await profileRepo.findLatestAvatar(userId);
  if (!row) throw new NotFoundError("no_profile_picture");

  // Serve via CloudFront when available — cached at edge, no S3 egress per user.
  const url = env.aws.cloudfrontDomain
    ? `https://${env.aws.cloudfrontDomain}/${row.s3_key}`
    : await getPresignedUrl(row.s3_bucket, row.s3_key, 3600);

  _avatarCache.set(key, { url, expiresAt: Date.now() + AVATAR_URL_TTL_MS });
  return url;
};
