/**
 * Login Controller
 *
 * Responsibilities:
 *  - Parse request data
 *  - Call the service layer
 *  - Send the HTTP response
 *
 * No business logic, no SQL, no try/catch soup.
 * All errors propagate to the global errorHandler via next(err).
 */

import * as loginService from "../services/loginService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";
// ─────────────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /login
 */
export const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const ipAddress =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await loginService.loginUser({ email, password, ipAddress, userAgent });
    const lang = result.user.preferredLanguage || "en";

    res.status(200).json({
      message: getApiMessage("login_success", lang),
      ...result,
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /forgot-password
 */
export const handleForgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    await loginService.handleForgotPassword(email);
    // Always return 200 to prevent email enumeration
    res.status(200).json({
      success: true,
      message: getApiMessage("forgot_password_sent", "en"),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Update Password
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PUT /update-password  (requires JWT)
 */
export const updatePassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    const userId = req.user.id;
    const lang = req.user.preferred_language || "en";

    await loginService.updatePassword(userId, newPassword);

    res.status(200).json({
      success: true,
      message: getApiMessage("password_updated", lang),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Delete Own Account  (in-app, authenticated)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /delete-account  (requires JWT)
 */
export const deleteUserAccount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const lang = req.user.preferred_language || "en";

    await loginService.deleteOwnAccount(userId);

    res.status(200).json({
      success: true,
      message: getApiMessage("account_deleted", lang),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Request Web Deletion  (public — sends OTP)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /request-deletion
 */
export const requestWebDeletion = async (req, res, next) => {
  try {
    const { email } = req.body;
    await loginService.requestWebDeletion(email);
    // Always return 200 to prevent email enumeration
    res.status(200).json({
      success: true,
      message: getApiMessage("deletion_code_sent", "en"),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Finalize Deletion  (verifies OTP or uses JWT id)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /finalize-deletion
 * Supports both the public web flow (email + OTP) and the in-app flow (JWT).
 */
export const finalizeDeletion = async (req, res, next) => {
  try {
    const { email, otpCode } = req.body;
    const authenticatedUserId = req.user?.id || null;
    const lang = req.user?.preferred_language || "en";

    await loginService.finalizeDeletion({ email, otpCode, authenticatedUserId });

    res.status(200).json({
      success: true,
      message: getApiMessage("account_deleted", lang),
    });
  } catch (err) {
    next(err);
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin / Officer Delete User
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DELETE /admin/delete/:userId  (requires JWT + officer role)
 */
export const adminDeleteUser = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const officerId = req.user.id;
    const officerBU = req.user.business_unit;
    const lang = req.user.preferred_language || "en";

    await loginService.adminDeleteUser({ userId, officerId, officerBU });

    res.status(200).json({
      success: true,
      message: getApiMessage("user_deleted", lang),
    });
  } catch (err) {
    next(err);
  }
};
