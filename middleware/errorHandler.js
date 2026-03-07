/**
 * Global Error Handler Middleware
 *
 * Mount LAST in app.js, after all routes:
 *   import { errorHandler } from "./middleware/errorHandler.js";
 *   app.use(errorHandler);
 *
 * Handles:
 *  - AppError subclasses (ValidationError, NotFoundError, etc.)
 *  - PostgreSQL constraint errors (23505 = duplicate key, 23503 = FK violation)
 *  - Zod validation errors (from middleware/validate.js)
 *  - Generic unhandled errors → 500 Internal Server Error
 *
 * Every error response is translated into the user's preferred language
 * using getApiMessage() from notificationTranslations.js.
 */

import { AppError } from "../errors/AppError.js";
import { formatApiMessage } from "../utils/notificationTranslations.js";

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the user's preferred language from the JWT payload on req.user.
 * Falls back to "en" for unauthenticated routes (login, register).
 */
const getUserLang = (req) => {
  const lang = req.user?.preferred_language;
  const valid = ["en", "ja", "id", "vi", "my", "km", "bn", "th"];
  return valid.includes(lang) ? lang : "en";
};

/**
 * Build a structured error response body.
 */
const buildErrorBody = (translatedMessage, errorCode) => {
  const body = { error: translatedMessage };
  if (errorCode) body.error_code = errorCode;
  return body;
};

// ─────────────────────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const lang = getUserLang(req);

  // ── 1. Known AppError (thrown by services / controllers) ─────────────────
  if (err instanceof AppError) {
    const message = formatApiMessage(err.messageKey, lang, err.replacements);
    return res
      .status(err.statusCode)
      .json(buildErrorBody(message, err.errorCode));
  }

  // ── 2. PostgreSQL: unique constraint violation (duplicate email, etc.) ────
  if (err.code === "23505") {
    const message = formatApiMessage("register_email_exists", lang);
    return res
      .status(409)
      .json(buildErrorBody(message, "api_errors.register.email_exists"));
  }

  // ── 3. PostgreSQL: foreign key violation (unknown role_name, etc.) ────────
  if (err.code === "23503") {
    // Try to extract the offending FK value from the PG error detail
    const badValue = err.detail?.match(/\(([^)]+)\)=\(([^)]+)\)/)?.[2] ?? "unknown";
    const message = formatApiMessage("register_validation_failed", lang);
    return res.status(400).json({
      error: message,
      detail: `Foreign key violation: value '${badValue}' not found in referenced table.`,
    });
  }

  // ── 4. Zod validation errors (from middleware/validate.js) ────────────────
  if (err.name === "ZodError") {
    const message = formatApiMessage("register_fields_required", lang);
    return res.status(400).json({
      error: message,
      error_code: "api_errors.validation.zod",
      details: err.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // ── 5. JWT errors ─────────────────────────────────────────────────────────
  if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
    const message = formatApiMessage("unauthorized", lang);
    return res.status(401).json(buildErrorBody(message, "api_errors.auth.invalid_token"));
  }

  // ── 6. CORS errors ────────────────────────────────────────────────────────
  if (err.message === "Not allowed by CORS") {
    return res.status(403).json({ error: "CORS: Origin not allowed" });
  }

  // ── 7. Catch-all — log full error, return generic 500 ────────────────────
  console.error(`[ErrorHandler] Unhandled error on ${req.method} ${req.path}:`, err);
  const message = formatApiMessage("internal_server_error", lang);
  return res.status(500).json(buildErrorBody(message, "api_errors.server.internal"));
}
