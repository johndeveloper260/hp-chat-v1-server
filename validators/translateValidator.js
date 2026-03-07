/**
 * Translate Validator (Zod)
 */
import { z } from "zod";

// ── POST /translate ───────────────────────────────────────────────────────────
export const translateSchema = z.object({
  text:       z.string({ required_error: "text is required" }).min(1, "text is required"),
  targetLang: z.string({ required_error: "targetLang is required" }).min(1, "targetLang is required"),
});
