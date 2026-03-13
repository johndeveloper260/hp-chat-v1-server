/**
 * Stream Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SDK imports. All errors propagate via next(err).
 */
import * as streamService from "../services/streamService.js";

/**
 * GET /stream/token  (and /stream/token/:userId — backward-compat)
 * User ID always comes from the verified JWT, never the URL.
 */
export const getStreamToken = async (req, res, next) => {
  try {
    const token = streamService.generateStreamToken(req.user.id);
    res.json({ token });
  } catch (err) { next(err); }
};

/**
 * POST /stream/channel/add-member
 * Body: { channelId: string, userId: string }
 * Uses the server-side admin client to bypass channel permission restrictions.
 */
export const addChannelMember = async (req, res, next) => {
  try {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: "channelId and userId are required" });
    }
    await streamService.addChannelMember(channelId, userId);
    res.json({ success: true });
  } catch (err) { next(err); }
};
