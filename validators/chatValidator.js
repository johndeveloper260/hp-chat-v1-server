import { z } from "zod";
export const createChatChannelSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(99),
  name: z.string().trim().min(1).max(200).optional(),
});
export const addChatMemberSchema = z.object({
  channelId: z.string().min(1).max(128),
  userId: z.string().uuid(),
});
