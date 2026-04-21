import { z } from "zod";

/** Used on PATCH /profile/update-language */
export const updateLanguageSchema = z.object({
  language: z.enum(["en", "ja", "id", "vi"]),
});

/** Used on PATCH /profile/update-notification */
export const updateNotificationSchema = z.object({
  notification: z.boolean(),
});

/** Used on PATCH /profile/update-auto-translate-chat */
export const updateAutoTranslateChatSchema = z.object({
  enabled: z.boolean(),
});

/** Used on PATCH /profile/update-translate-exceptions */
export const updateTranslateExceptionsSchema = z.object({
  exceptions: z.array(z.string()).default([]),
});

/** Used on PATCH /profile/update-theme */
export const updateThemeSchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

/** Used on PATCH /profile/reset-password/:userId */
export const adminResetPasswordSchema = z.object({
  newPassword: z
    .string({ required_error: "New password is required" })
    .min(6, "Password must be at least 6 characters"),
});
