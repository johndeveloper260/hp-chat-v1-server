/**
 * Translate Service
 *
 * Supports two providers, selected via TRANSLATION_PROVIDER env var:
 *   "google" (default) — Google Cloud Translate v2
 *   "openai"           — GPT-4o mini
 *
 * No req/res — throws AppError subclasses on failure.
 */
import { v2 } from "@google-cloud/translate";
import env from "../config/env.js";
import { ValidationError } from "../errors/AppError.js";

const { Translate } = v2;

// ── Google Cloud Translate (v2) ────────────────────────────────────────────

// Lazy singleton — avoids re-parsing JSON credentials on every request
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

const googleTranslate = async (text, targetLang) => {
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

// ── GPT-4o mini ────────────────────────────────────────────────────────────

const gptTranslate = async (text, targetLang) => {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.openai.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `Translate the chat message to language code "${targetLang}". ` +
            `Match the informality of the source. Preserve emoji and punctuation. ` +
            `Reply ONLY with valid JSON: {"translated":"<text>","source":"<ISO 639-1 code>"}.`,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
      temperature: 0.1,
    }),
  });

  if (!res.ok) throw new Error(`[translateService] OpenAI API error: ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return {
    original: text,
    translated: parsed.translated || text,
    targetLanguage: targetLang,
    detectedSource: parsed.source || "unknown",
  };
};

// ── Unified export ─────────────────────────────────────────────────────────

export const translateText = async (text, targetLang) => {
  if (!text || !targetLang || targetLang === "nil") {
    throw new ValidationError(
      "translate_fields_required",
      "api_errors.translate.fields_required",
    );
  }

  return env.translation.provider === "openai"
    ? gptTranslate(text, targetLang)
    : googleTranslate(text, targetLang);
};
