/**
 * Translate Service
 *
 * Wraps Google Cloud Translate v2.
 * Lazy-initialises the client so credentials are parsed once.
 * No req/res — throws AppError subclasses on failure.
 */
import { v2 } from "@google-cloud/translate";
import env from "../config/env.js";
import { ValidationError } from "../errors/AppError.js";

const { Translate } = v2;

// Lazy singleton ─ avoids re-parsing JSON credentials on every request
let _translate;
const getTranslateClient = () => {
  if (!_translate) {
    let credentials;
    try {
      credentials = JSON.parse(env.google.credentials);
    } catch {
      throw new Error("[translateService] CREDENTIALS env var is not valid JSON.");
    }
    _translate = new Translate({
      credentials,
      projectId: credentials.project_id,
    });
  }
  return _translate;
};

// ─────────────────────────────────────────────────────────────────────────────

export const translateText = async (text, targetLang) => {
  if (!text || !targetLang || targetLang === "nil") {
    throw new ValidationError(
      "translate_fields_required",
      "api_errors.translate.fields_required",
    );
  }

  const client = getTranslateClient();
  const [translatedText, metadata] = await client.translate(text, targetLang);
  const detectedSource = metadata?.detections?.[0]?.[0]?.language || "unknown";

  return {
    original: text,
    translated: translatedText,
    targetLanguage: targetLang,
    detectedSource,
  };
};
