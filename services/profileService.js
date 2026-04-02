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
    lockScreenExpire: row?.lock_screen_expire ?? false,
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

// ── Avatar ────────────────────────────────────────────────────────────────────

/**
 * Returns a short-lived presigned S3 URL for the user's latest profile picture.
 * Throws NotFoundError if no picture has been uploaded.
 */
export const getUserAvatarUrl = async (userId) => {
  const row = await profileRepo.findLatestAvatar(userId);
  if (!row) throw new NotFoundError("no_profile_picture");
  return getPresignedUrl(row.s3_bucket, row.s3_key, 3600);
};
