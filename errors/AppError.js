/**
 * Custom Application Error Classes
 *
 * Every thrown error in a service/repository should be one of these.
 * The global errorHandler middleware reads these properties to build
 * the correct HTTP response — including the right translated message.
 *
 * Usage in a service:
 *   throw new NotFoundError("register_invalid_code", "api_errors.register.invalid_code");
 *
 * The errorHandler will:
 *   1. Look up `messageKey` in notificationTranslations.apiMessages
 *   2. Resolve it in the user's preferred language
 *   3. Return { error: "<translated text>", error_code: "<frontend i18n key>" }
 */

// ─── Base ──────────────────────────────────────────────────────────────────
export class AppError extends Error {
  /**
   * @param {string} messageKey  - Key into apiMessages (e.g. "register_invalid_code")
   * @param {number} statusCode  - HTTP status (default 500)
   * @param {string} [errorCode] - Frontend i18n key (e.g. "api_errors.register.invalid_code")
   * @param {object} [replacements] - Placeholder values for {{token}} substitution
   */
  constructor(messageKey, statusCode = 500, errorCode = null, replacements = {}) {
    super(messageKey); // message = key for logging; translated text resolved at handler
    this.name = this.constructor.name;
    this.messageKey = messageKey;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.replacements = replacements;
    // Capture stack but exclude the constructor frame for cleaner traces
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ─── 400 Bad Request ───────────────────────────────────────────────────────
export class ValidationError extends AppError {
  constructor(messageKey, errorCode = null, replacements = {}) {
    super(messageKey, 400, errorCode, replacements);
  }
}

// ─── 401 Unauthorized ─────────────────────────────────────────────────────
export class UnauthorizedError extends AppError {
  constructor(messageKey = "unauthorized", errorCode = null, replacements = {}) {
    super(messageKey, 401, errorCode, replacements);
  }
}

// ─── 403 Forbidden ────────────────────────────────────────────────────────
export class ForbiddenError extends AppError {
  constructor(messageKey = "forbidden", errorCode = null, replacements = {}) {
    super(messageKey, 403, errorCode, replacements);
  }
}

// ─── 404 Not Found ────────────────────────────────────────────────────────
export class NotFoundError extends AppError {
  constructor(messageKey = "record_not_found", errorCode = null, replacements = {}) {
    super(messageKey, 404, errorCode, replacements);
  }
}

// ─── 409 Conflict ─────────────────────────────────────────────────────────
export class ConflictError extends AppError {
  constructor(messageKey = "register_email_exists", errorCode = null, replacements = {}) {
    super(messageKey, 409, errorCode, replacements);
  }
}

// ─── 422 Unprocessable Entity ─────────────────────────────────────────────
export class UnprocessableError extends AppError {
  constructor(messageKey, errorCode = null, replacements = {}) {
    super(messageKey, 422, errorCode, replacements);
  }
}
