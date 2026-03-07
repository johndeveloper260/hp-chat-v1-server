import { z } from "zod";

/** Used on PATCH /profile/update-language */
export const updateLanguageSchema = z.object({
  language: z.enum(["en", "ja", "id", "vi"]),
});
