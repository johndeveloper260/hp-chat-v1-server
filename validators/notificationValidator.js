import { z } from "zod";

export const savePushTokenSchema = z.object({
  expoPushToken: z.string().min(1, "Push token is required"),
});

export const deletePushTokenSchema = z.object({
  expoPushToken: z.string().min(1, "Push token is required"),
});

export const sendTestNotificationSchema = z.object({
  userId: z.string().min(1),
  title:  z.string().min(1),
  body:   z.string().min(1),
  data:   z.record(z.string(), z.unknown()).optional(),
});
