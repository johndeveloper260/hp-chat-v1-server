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
import { splitForTranslation, mapWithConcurrency } from "../utils/translationChunks.js";

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

const sanitizeOpenAIError = (text) => text.replace(/sk-[A-Za-z0-9_*.-]+/g, "sk-***");

// Scripts like Burmese, Khmer, Thai and Bengali can cost several tokens per
// character, so budget generously — max_tokens is a ceiling, not a charge.
const getTranslationMaxTokens = (text) =>
  Math.min(16384, Math.max(1000, text.length * 4));

const hasMissingLines = (original, translated) => {
  const originalLines = original.split(/\r?\n/).filter((line) => line.trim()).length;
  const translatedLines = translated.split(/\r?\n/).filter((line) => line.trim()).length;
  return originalLines > 1 && translatedLines < originalLines;
};

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
            `Translate the text to language code "${targetLang}". ` +
            `Translate every line completely. Do not summarize, omit, merge, or shorten any line. ` +
            `Preserve the original line breaks, line order, emoji, punctuation, and informality. ` +
            `Reply ONLY with valid JSON: {"translated":"<text>","source":"<ISO 639-1 code>"}.`,
        },
        { role: "user", content: text },
      ],
      response_format: { type: "json_object" },
      max_tokens: getTranslationMaxTokens(text),
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `[translateService] OpenAI API error: ${res.status} ${sanitizeOpenAIError(errorText).slice(0, 500)}`,
    );
  }
  const data = await res.json();
  if (data.choices?.[0]?.finish_reason === "length") {
    throw new Error("[translateService] OpenAI translation was truncated by token limit.");
  }
  const parsed = JSON.parse(data.choices[0].message.content);
  const translated = parsed.translated || text;
  if (hasMissingLines(text, translated)) {
    throw new Error("[translateService] OpenAI translation omitted one or more source lines.");
  }
  return {
    original: text,
    translated,
    targetLanguage: targetLang,
    detectedSource: parsed.source || "unknown",
  };
};

// ── Unified export ─────────────────────────────────────────────────────────
//
// Long texts (announcements) are split into chunks translated in parallel:
// one huge request can exceed the output token budget or Heroku's 30s
// request timeout.

const MAX_CHUNK_CHARS = 1000;
const MAX_PARALLEL_CHUNKS = 6;

export const translateText = async (text, targetLang) => {
  if (!text || !targetLang || targetLang === "nil") {
    throw new ValidationError(
      "translate_fields_required",
      "api_errors.translate.fields_required",
    );
  }

  const translateChunk = env.translation.provider === "openai" ? gptTranslate : googleTranslate;
  const chunks = splitForTranslation(text, MAX_CHUNK_CHARS);
  if (chunks.length === 1) return translateChunk(text, targetLang);

  const results = await mapWithConcurrency(chunks, MAX_PARALLEL_CHUNKS, (chunk) =>
    chunk.text.trim() ? translateChunk(chunk.text, targetLang) : null,
  );
  return {
    original: text,
    translated: chunks
      .map((chunk, i) => (results[i]?.translated ?? chunk.text) + chunk.sep)
      .join(""),
    targetLanguage: targetLang,
    detectedSource:
      results.find((r) => r && r.detectedSource !== "unknown")?.detectedSource || "unknown",
  };
};
