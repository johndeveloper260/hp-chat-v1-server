/**
 * Register Controller
 *
 * Responsibilities:
 *  - Parse request data
 *  - Call the service layer
 *  - Send the HTTP response
 *
 * No business logic, no SQL, no try/catch soup.
 * All errors propagate to the global errorHandler via next(err).
 */

import * as registerService from "../services/registerService.js";
import { getApiMessage } from "../utils/notificationTranslations.js";

// ── POST /register/validate-code ─────────────────────────────────────────────
export const validateCode = async (req, res, next) => {
  try {
    // req.body already validated + coerced by validate(validateCodeSchema)
    const record = await registerService.validateRegistrationCode(req.body.code);

    res.json({
      valid: true,
      business_unit: record.business_unit,
      role: record.role_name,
      company_id: record.company,
      batch_no: record.batch_no,
    });
  } catch (err) {
    next(err);
  }
};

// ── POST /register/registerUser ───────────────────────────────────────────────
export const registerUser = async (req, res, next) => {
  try {
    // req.body already validated + coerced by validate(registerSchema)
    const result = await registerService.registerUser(req.body);

    const lang = req.body?.preferredLanguage || "en";
    const message = getApiMessage("register_success", lang);

    res.status(201).json({
      message,
      ...result, // { user, streamToken }
    });
  } catch (err) {
    next(err);
  }
};
