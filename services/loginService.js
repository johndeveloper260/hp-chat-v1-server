/**
 * Login Service
 *
 * All authentication business logic lives here.
 * No req/res — throws AppError subclasses on failure.
 */

import bcrypt from "bcrypt";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { StreamClient } from "@stream-io/node-sdk";
import { StreamChat } from "stream-chat";

import env from "../config/env.js";
import {
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
} from "../errors/AppError.js";
import * as userRepo from "../repositories/userRepository.js";
import * as emailService from "../config/systemMailer.js";
import { deleteFromS3 } from "../controller/attachmentController.js";

// Lazy singleton — avoids re-initialising on every request
let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) {
    _streamChat = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamChat;
};

// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authenticate a user and return token + full user object + stream token.
 *
 * @param {{ email: string, password: string, ipAddress: string, userAgent: string }} input
 * @returns {{ token, user, streamToken, roles }}
 */
export async function loginUser({ email, password, ipAddress, userAgent }) {
  // 1. Fetch user record
  const user = await userRepo.findUserByEmail(email);
  if (!user) {
    throw new UnauthorizedError(
      "login_invalid_credentials",
      "api_errors.login.invalid_credentials",
    );
  }

  // 2. Verify password
  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    throw new UnauthorizedError(
      "login_invalid_credentials",
      "api_errors.login.invalid_credentials",
    );
  }

  // 3. Check account is active
  if (user.is_active === false) {
    throw new ForbiddenError(
      "login_account_deactivated",
      "api_errors.login.account_deactivated",
    );
  }

  // 4. Stamp last_login + access log (fire both, non-critical)
  await Promise.all([
    userRepo.updateLastLogin(user.id),
    userRepo.logAccess({
      userId: user.id,
      businessUnit: user.business_unit,
      ipAddress,
      userAgent,
    }),
  ]);

  // 5. Fetch roles
  const roles = await userRepo.findUserRoles(user.id);

  // 6. Build JWT payload
  const payload = {
    id: String(user.id).trim(),
    user_type: user.user_type,
    business_unit: user.business_unit,
    company: user.company,
    company_name: user.company_name,
    visa_type_descr: user.visa_type_descr,
    batch_no: user.batch_no,
    preferred_language: user.preferred_language || "en",
    roles,
  };

  const token = jwt.sign(payload, env.jwt.secret.trim(), {
    expiresIn: env.jwt.expiresIn,
  });

  // 7. Generate Stream token (chat + video)
  const nodeClient = new StreamClient(env.stream.apiKey, env.stream.apiSecret);
  const streamToken = nodeClient.generateUserToken({
    user_id: String(user.id),
    validity_period_hs: env.stream.tokenValidityHours,
  });

  // 8. Build profile picture URL using the permanent proxy endpoint
  const profilePictureUrl = user.profile_pic_s3_key
    ? `${env.app.backendUrl}/profile/avatar/${user.id}`
    : null;

  return {
    token,
    streamToken,
    roles,
    user: {
      id: user.id,
      email: user.email,
      businessUnit: user.business_unit,
      isActive: user.is_active,
      preferredLanguage: user.preferred_language || "en",
      userId: user.user_id,
      firstName: user.first_name,
      middleName: user.middle_name,
      lastName: user.last_name,
      userType: user.user_type,
      position: user.position,
      company: user.company,
      company_name: user.company_name,
      company_ticketing: user.company_ticketing ?? false,
      company_flight_tracker: user.company_flight_tracker ?? false,
      company_form: user.company_form ?? false,
      batch_no: user.batch_no,
      companyBranch: user.company_branch,
      visa_type_descr: user.visa_type_descr,
      phoneNumber: user.phone_number,
      postalCode: user.postal_code,
      streetAddress: user.street_address,
      city: user.city,
      stateProvince: user.state_province,
      visaType: user.visa_type,
      visaExpiry: user.visa_expiry_date,
      passportExpiry: user.passport_expiry,
      lockScreenExpire: user.lock_screen_expire ?? false,
      accountCreatedAt: user.account_created_at,
      profilePicId: user.profile_pic_id,
      profilePictureUrl,
      notification: user.notification ?? true,
      profilePicS3Key: user.profile_pic_s3_key,
      profilePicS3Bucket: user.profile_pic_s3_bucket,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate and email a temporary password.
 * Always returns success to avoid email enumeration.
 */
export async function handleForgotPassword(email) {
  const userId = await userRepo.findUserIdByEmail(email);

  // Security: silently succeed even if email not found
  if (!userId) return;

  const resetCode = crypto.randomBytes(4).toString("hex");
  const hashedPassword = await bcrypt.hash(resetCode, 10);

  await userRepo.updatePasswordHashByEmail(email, hashedPassword);
  await emailService.passwordResetCode(email, "Your Temporary Password", resetCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} userId
 * @param {string} newPassword - Already validated (min 6 chars) by Zod schema
 */
export async function updatePassword(userId, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 10);
  const rowCount = await userRepo.updatePasswordHash(userId, passwordHash);

  if (rowCount === 0) {
    throw new NotFoundError("user_not_found");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Deletion helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete all profile S3 files + DB rows for a user.
 */
async function cleanupProfileAttachments(userId) {
  const attachments = await userRepo.findProfileAttachments(userId);
  for (const row of attachments) {
    try {
      await deleteFromS3(row.s3_key);
    } catch (s3Err) {
      console.warn(`[LoginService] S3 cleanup skipped for ${row.s3_key}:`, s3Err.message);
    }
  }
  if (attachments.length > 0) {
    await userRepo.deleteProfileAttachments(userId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Own Account (authenticated, in-app)
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteOwnAccount(userId) {
  await userRepo.archiveUserBeforeDelete(userId, "SELF", "In-App Deletion");
  await getStreamChat().deleteUser(userId, { mark_messages_deleted: false, hard: false });
  await cleanupProfileAttachments(userId);
  const rowCount = await userRepo.deleteUserById(userId);
  if (rowCount === 0) {
    throw new NotFoundError("user_not_found");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Request Web Deletion (public — sends OTP)
// ─────────────────────────────────────────────────────────────────────────────

export async function requestWebDeletion(email) {
  const userId = await userRepo.findUserIdByEmail(email);
  // Security: always silently succeed
  if (!userId) return;

  const otpCode = crypto.randomInt(100000, 999999).toString();
  const otpExpiry = new Date(Date.now() + 15 * 60_000); // 15 minutes

  await userRepo.setOtp({ email, otpCode, otpExpiry });
  await emailService.sendDeletionCode(email, "Account Deletion Request", otpCode);
}

// ─────────────────────────────────────────────────────────────────────────────
// Finalize Deletion (verifies OTP, then hard-deletes)
// ─────────────────────────────────────────────────────────────────────────────

export async function finalizeDeletion({ email, otpCode, authenticatedUserId }) {
  let targetId;

  if (authenticatedUserId) {
    // In-app path — user already verified by JWT
    targetId = authenticatedUserId;
  } else {
    // Web/public path — verify OTP
    if (!email || !otpCode) {
      throw new ValidationError(
        "missing_required_fields",
        "api_errors.login.fields_required",
      );
    }

    const userRecord = await userRepo.findUserForOtp(email);
    if (
      !userRecord ||
      userRecord.otp_code !== otpCode ||
      new Date() > userRecord.otp_expiry
    ) {
      throw new UnauthorizedError(
        "login_invalid_otp",
        "api_errors.login.invalid_otp",
      );
    }
    targetId = userRecord.id;
  }

  await userRepo.archiveUserBeforeDelete(targetId, "SELF", "In-App Deletion");
  await getStreamChat().deleteUsers([String(targetId)], {
    user: "hard",
    messages: "hard",
    conversations: "hard",
  });
  await cleanupProfileAttachments(targetId);
  await userRepo.deleteUserById(targetId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin Delete User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ userId, officerId, officerBU }} params
 */
export async function adminDeleteUser({ userId, officerId, officerBU }) {
  // Guard: prevent self-deletion via this route
  if (String(userId) === String(officerId)) {
    throw new ValidationError(
      "login_cannot_delete_self",
      "api_errors.login.cannot_delete_self",
    );
  }

  // Verify target belongs to same business unit
  const target = await userRepo.findUserInBusinessUnit(userId, officerBU);
  if (!target) {
    throw new NotFoundError("user_not_found");
  }

  await userRepo.archiveUserBeforeDelete(userId, officerId, "Officer-initiated deletion");
  await getStreamChat().deleteUsers([String(userId)], {
    user: "hard",
    messages: "hard",
    conversations: "hard",
  });
  await cleanupProfileAttachments(userId);
  await userRepo.deleteUserById(userId);
}
