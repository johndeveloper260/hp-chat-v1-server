/**
 * Translate Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SDK imports. All errors propagate via next(err).
 */
import * as translateService from "../services/translateService.js";

export const translateText = async (req, res, next) => {
  try {
    const { text, targetLang } = req.body;
    const data = await translateService.translateText(text, targetLang);
    res.status(200).json({ success: true, data });
  } catch (err) {
    // Google Translate error code 3 = invalid language code — keep as 400, not 500
    if (err.code === 3) {
      return res.status(400).json({ success: false, message: "Invalid language code." });
    }
    next(err);
  }
};
