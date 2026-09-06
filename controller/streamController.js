/**
 * Stream Controller
 *
 * Responsibilities: parse request → call service → send response.
 * No SDK imports. All errors propagate via next(err).
 */
import * as streamService from "../services/streamService.js";
import * as chatAccess from "../services/chatAccessService.js";
import { syncUserToStream } from "../utils/syncUserToStream.js";

/**
 * GET /stream/token  (and /stream/token/:userId — backward-compat)
 * User ID always comes from the verified JWT, never the URL.
 */
export const getStreamToken = async (req, res, next) => {
  try {
    // Repair the current user's Stream metadata from the authoritative DB
    // before the client connects and starts company-scoped queries.
    await syncUserToStream(req.user.id);
    const token = streamService.generateStreamToken(req.user.id);
    res.json({ token });
  } catch (err) { next(err); }
};

/**
 * POST /stream/channel/add-member
 * Body: { channelId: string, userId: string }
 * Uses the server-side admin client to bypass channel permission restrictions.
 *
 * That bypass is exactly why this needs an authorization check of its own. The
 * route took any channelId and any userId from the body behind nothing but
 * `auth`, and then added them with admin rights — so any authenticated account
 * could add anyone to any channel in the app, whatever the client UI offered.
 * The caller must be allowed to chat with the person they are adding, and must
 * already be in the channel themselves.
 */
export const addChannelMember = async (req, res, next) => {
  try {
    const { channelId, userId } = req.body;
    if (!channelId || !userId) {
      return res.status(400).json({ error: "channelId and userId are required" });
    }
    await chatAccess.addScopedChannelMember(req.user.id, channelId, userId);
    res.json({ success: true });
  } catch (err) {
    console.error("[addChannelMember] error:", err?.message || err);
    next(err);
  }
};

/**
 * GET /stream/contacts?search=
 * The authoritative list of accounts the caller may start a conversation with.
 */
export const getChatContacts = async (req, res, next) => {
  try {
    const contacts = await chatAccess.getChatContacts(req.user.id, req.query.search);
    res.json(contacts);
  } catch (err) { next(err); }
};

/**
 * POST /stream/authorize-members
 * Body: { userIds: string[] }
 * Called before a group channel is created client-side. Confirms every proposed
 * member is in scope, so a group cannot be assembled out of a hand-built list.
 */
export const authorizeChatMembers = async (req, res, next) => {
  try {
    const { userIds } = req.body;
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ error: "userIds must be a non-empty array" });
    }
    const authorized = await chatAccess.assertCanChatWithAll(req.user.id, userIds);
    res.json({ authorized: true, userIds: authorized });
  } catch (err) { next(err); }
};

export const createChatChannel = async (req, res, next) => {
  try {
    res.status(201).json(await chatAccess.createChatChannel(req.user.id, req.body));
  } catch (err) { next(err); }
};

export const removeChannelMember = async (req, res, next) => {
  try {
    await chatAccess.removeScopedChannelMember(req.user.id, req.body.channelId, req.body.userId);
    res.json({ success: true });
  } catch (err) { next(err); }
};
