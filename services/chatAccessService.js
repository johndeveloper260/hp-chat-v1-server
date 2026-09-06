/**
 * Chat access service.
 *
 * Decides who may talk to whom, and keeps Stream in step when that answer
 * changes. The clients build their user pickers from Stream's queryUsers with
 * client-side filters; those filters shape the UI, they do not enforce anything.
 * Anything that creates a conversation or adds a member goes through
 * assertCanChat() here.
 *
 * ── What is enforced here vs. what needs Stream configuration ────────────────
 *
 * Enforced by this backend, verifiable locally:
 *   - POST /stream/channel/add-member (server-side admin client)
 *   - GET  /stream/contacts (the authoritative contact list for the pickers)
 *   - deactivation: Stream user deactivated and tokens revoked
 *   - BU revocation: membership pruned from channels outside the new scope
 *
 * NOT enforceable from this repo — see the handoff:
 *   - a client calling Stream's queryUsers directly with its own filters
 *   - a client creating a channel directly through the Stream SDK
 * Both need Stream dashboard configuration (user-search permission and channel
 * creation permission on the messaging channel type). Neither can be verified
 * from here, because it lives in the Stream app config, not in this codebase.
 */
import crypto from "node:crypto";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";
import * as chatRepo from "../repositories/chatAccessRepository.js";
import { ForbiddenError } from "../errors/AppError.js";
import { sameSendingOrg } from "../utils/souserScope.js";

let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) {
    _streamChat = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamChat;
};

const ELEVATED = ["OFFICER", "ADMIN"];
const upper = (v) => String(v ?? "").toUpperCase();

const normalise = (row) => {
  if (!row) return null;
  const userType = upper(row.user_type) || "USER";
  const buAccess = Array.isArray(row.bu_access) ? row.bu_access.map(String) : [];
  return {
    id: String(row.id),
    isActive: row.is_active !== false,
    userType,
    businessUnit: row.business_unit ? String(row.business_unit) : null,
    // A SOUSER's reach is their grant list; everyone else's is their own BU.
    businessUnits: userType === "SOUSER"
      ? buAccess
      : (row.business_unit ? [String(row.business_unit)] : []),
    sendingOrg: row.sending_org ?? null,
    company: row.company ?? null,
    isPrivileged: ELEVATED.includes(userType),
  };
};

export const loadIdentity = async (userId, client) => normalise(await chatRepo.findChatIdentity(userId, client));

const overlaps = (a, b) => a.businessUnits.some((bu) => b.businessUnits.includes(bu));

/**
 * Pure decision: may `actor` hold a conversation with `target`?
 *
 * Exported for testing — the DB-backed wrappers below are thin.
 *
 * A SOUSER may reach their own organisation's people and the coordinators of
 * the BUs they are authorised in. Nobody may reach a deactivated account, and
 * no pairing crosses a BU boundary neither side is authorised in.
 */
export const canChat = (actor, target) => {
  if (!actor || !target) return false;
  if (!actor.isActive || !target.isActive) return false;
  if (actor.id === target.id) return false;
  if (!overlaps(actor, target)) return false;

  // Coordinators talk to anyone inside their BU.
  if (actor.isPrivileged || target.isPrivileged) return true;

  // At least one side is a SOUSER → both sides must be the same organisation.
  if (actor.userType === "SOUSER" || target.userType === "SOUSER") {
    return sameSendingOrg(actor.sendingOrg, target.sendingOrg);
  }

  // Preserve the USER picker policy: employees share a company.
  return !!actor.company && !!target.company && String(actor.company) === String(target.company);
};

/** Throws ForbiddenError when the pairing is not allowed. */
export const assertCanChat = async (actorId, targetId) => {
  const [actor, target] = await Promise.all([loadIdentity(actorId), loadIdentity(targetId)]);
  if (!canChat(actor, target)) {
    throw new ForbiddenError("chat_contact_not_permitted", "api_errors.chat.contact_not_permitted");
  }
  return { actor, target };
};

/**
 * The authoritative contact list for the web and mobile user pickers.
 * Replaces filtering a raw Stream queryUsers result on the client.
 */
export const getChatContacts = async (userId, search = null) => {
  const actor = await loadIdentity(userId);
  if (!actor || !actor.isActive) {
    throw new ForbiddenError("chat_contact_not_permitted", "api_errors.chat.contact_not_permitted");
  }

  const term = search && String(search).trim() ? String(search).trim() : null;

  if (actor.userType === "SOUSER") {
    if (!actor.sendingOrg || !actor.businessUnits.length) return [];  // fail closed
    return chatRepo.findSouserContacts({
      businessUnits: actor.businessUnits,
      sendingOrg: actor.sendingOrg,
      search: term,
    });
  }

  return chatRepo.findStandardContacts({
    businessUnit: actor.businessUnit,
    sendingOrg: actor.sendingOrg,
    isPrivileged: actor.isPrivileged,
    company: actor.company,
    search: term,
  });
};

/**
 * Every member of a channel must be someone `actorId` may chat with.
 * Used when a group is created or a member is added.
 */
export const assertCanChatWithAll = async (actorId, targetIds, identityLoader = loadIdentity) => {
  const ids = [...new Set([String(actorId), ...(targetIds ?? []).map(String)])];
  const identities = await Promise.all(ids.map((id) => identityLoader(id)));
  if (identities.some((identity) => !identity || !identity.isActive)) {
    throw new ForbiddenError("chat_contact_not_permitted", "api_errors.chat.contact_not_permitted");
  }
  // Check every pair: an officer must not bridge two unrelated organisations.
  for (let i = 0; i < identities.length; i++) {
    for (let j = i + 1; j < identities.length; j++) {
      const left = identities[i], right = identities[j];
      // Existing officer-managed USER groups may span companies. Only SOUSER
      // membership requires every pair to share its organisation boundary.
      if (left.id !== String(actorId) && right.id !== String(actorId) &&
          left.userType !== "SOUSER" && right.userType !== "SOUSER") continue;
      if (!canChat(left, right)) {
        throw new ForbiddenError("chat_contact_not_permitted", "api_errors.chat.contact_not_permitted");
      }
    }
  }
  return ids.filter((id) => id !== String(actorId));
};

export const listChannelMemberIds = async (channel) => {
  const ids = [];
  let cursor;
  for (;;) {
    const { members = [] } = await channel.queryMembers({}, { user_id: 1 },
      { limit: 100, ...(cursor ? { user_id_gt: cursor } : {}) });
    const page = members.map((m) => m.user_id ?? m.user?.id).filter(Boolean).map(String);
    ids.push(...page);
    if (members.length < 100) return [...new Set(ids)];
    const next = page.at(-1);
    if (!next || next === cursor) throw new Error("Channel member pagination did not advance");
    cursor = next;
  }
};

export const createChatChannel = async (actorId, { userIds, name }, dependencies = {}) => {
  const chat = dependencies.chat ?? getStreamChat();
  const identityLoader = dependencies.loadIdentity ?? loadIdentity;
  const targets = await assertCanChatWithAll(actorId, userIds, identityLoader);
  const members = [String(actorId), ...targets].sort();
  const isGroup = typeof name === "string";
  if (!isGroup && targets.length !== 1) {
    throw new ForbiddenError("chat_contact_not_permitted", "api_errors.chat.contact_not_permitted");
  }
  if (!isGroup) {
    const existing = await chat.queryChannels(
      { type: "messaging", members: { $eq: members } }, { last_message_at: -1 },
      { limit: 1, state: false, watch: false },
    );
    if (existing.length) return { channelId: existing[0].id };
  }
  const id = isGroup ? `grp-${crypto.randomUUID()}`
    : `dm-${crypto.createHash("sha256").update(members.join(":" )).digest("hex").slice(0, 32)}`;
  const channel = chat.channel("messaging", id, {
    members, created_by_id: String(actorId), ...(isGroup ? { name: name.trim() } : {}),
  });
  await channel.create();
  return { channelId: channel.id };
};

export const addScopedChannelMember = async (actorId, channelId, targetId, dependencies = {}) => {
  const chat = dependencies.chat ?? getStreamChat();
  const channel = chat.channel("messaging", channelId);
  const members = await listChannelMemberIds(channel);
  if (!members.includes(String(actorId))) {
    throw new ForbiddenError("chat_not_channel_member", "api_errors.chat.not_channel_member");
  }
  await assertCanChatWithAll(actorId, [...members, String(targetId)], dependencies.loadIdentity ?? loadIdentity);
  await channel.addMembers([String(targetId)]);
};

// ── Stream side effects ───────────────────────────────────────────────────────

/**
 * Cut off chat for a deactivated account.
 *
 * Two calls, both needed. deactivateUser stops new activity; revokeUserToken
 * invalidates tokens already in the client's hands — a Stream token is verified
 * by signature, not looked up, so it stays valid for its full lifetime
 * (env.stream.tokenValidityHours) unless it is explicitly revoked.
 */
export const revokeStreamAccess = async (userId) => {
  const chat = getStreamChat();
  await chat.revokeUserToken(String(userId), new Date());
  try {
    await chat.deactivateUser(String(userId), { mark_messages_deleted: false });
  } catch (err) {
    // Already deactivated is not a failure.
    if (!/already\s+deactivated/i.test(err?.message ?? "")) throw err;
  }
};

/** Reverse of revokeStreamAccess, for reactivation. */
export const restoreStreamAccess = async (userId) => {
  const chat = getStreamChat();
  try {
    await chat.reactivateUser(String(userId));
  } catch (err) {
    if (!/not\s+deactivated/i.test(err?.message ?? "")) throw err;
  }
};

/**
 * Remove an account from every channel it is a member of but no longer
 * authorised for.
 *
 * Attribute changes do not touch membership: revoking a BU updates bu_access on
 * the Stream user, but the account stays a member of every channel it already
 * joined and keeps reading and posting there. This walks its channels and drops
 * it from any whose other members it may no longer chat with.
 *
 * Best-effort by design — the caller reports a failure as a warning rather than
 * failing the officer's revoke.
 */
export const pruneOutOfScopeChannels = async (userId, dependencies = {}) => {
  const chat = dependencies.chat ?? getStreamChat();
  const identityLoader = dependencies.loadIdentity ?? loadIdentity;
  const actor = await identityLoader(userId);
  if (!actor) return { removed: 0, checked: 0 };
  // Snapshot all IDs before mutating membership, so offsets cannot skip channels.
  const channels = [];
  let createdAt;
  let boundaryIds = [];
  for (;;) {
    const page = await chat.queryChannels(
      { members: { $in: [String(userId)] },
        ...(createdAt ? { created_at: { $gte: createdAt }, cid: { $nin: boundaryIds } } : {}) },
      { created_at: 1 }, { limit: 30, state: false, watch: false },
    );
    channels.push(...page);
    if (page.length < 30) break;
    const lastTime = page.at(-1).data?.created_at;
    if (!lastTime) throw new Error("Channel pagination requires created_at");
    const timestamp = String(lastTime);
    const ids = page.filter((ch) => String(ch.data?.created_at) === timestamp).map((ch) => ch.cid);
    boundaryIds = timestamp === createdAt ? [...boundaryIds, ...ids] : ids;
    createdAt = timestamp;
  }
  let removed = 0;
  for (const channel of channels) {
    const others = (await listChannelMemberIds(channel)).filter((id) => id !== String(userId));
    const identities = await Promise.all(others.map((id) => identityLoader(id)));
    const allowed = actor.isActive && actor.businessUnits.length > 0 &&
      identities.every((other) => other && canChat(actor, other));
    if (!allowed) {
      if (!dependencies.dryRun) await channel.removeMembers([String(userId)]);
      removed++;
    }
  }
  return dependencies.dryRun ? { wouldRemove: removed, checked: channels.length } : { removed, checked: channels.length };
};

export const removeScopedChannelMember = async (actorId, channelId, targetId, dependencies = {}) => {
  const chat = dependencies.chat ?? getStreamChat();
  const identityLoader = dependencies.loadIdentity ?? loadIdentity;
  const channel = chat.channel("messaging", channelId);
  const members = await listChannelMemberIds(channel);
  if (!members.includes(String(actorId))) {
    throw new ForbiddenError("chat_not_channel_member", "api_errors.chat.not_channel_member");
  }
  // Existing clients allow channel members to remove members or leave.
  // Removal cannot expand an audience; preserve that behavior server-side.
  const actor = await identityLoader(actorId);
  if (!actor?.isActive) throw new ForbiddenError("chat_contact_not_permitted");
  if (members.includes(String(targetId))) await channel.removeMembers([String(targetId)]);
};
