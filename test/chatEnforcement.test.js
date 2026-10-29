import test from "node:test";
import assert from "node:assert/strict";
for (const key of ["DB_HOST", "DB_USER", "DB_PASS", "DB_DATABASE", "SECRET_TOKEN", "STREAM_API_KEY", "STREAM_API_SECRET"]) process.env[key] ??= "test";
const { createChatChannel, addScopedChannelMember, pruneOutOfScopeChannels, listChannelMemberIds } = await import("../services/chatAccessService.js");
const { createChatChannelSchema } = await import("../validators/chatValidator.js");
const so = (id, org = "A", bus = ["BU"]) => ({ id, userType: "SOUSER", isActive: true, sendingOrg: org, businessUnits: bus });
const officer = { id: "off", userType: "OFFICER", isActive: true, isPrivileged: true, businessUnits: ["BU"] };
const user = (id, company = "C1", isActive = true) => ({ id, userType: "USER", isActive, company, businessUnits: ["BU"] });
const identities = { a: so("a"), b: so("b", "B"), friend: so("friend"), off: officer,
  u1: user("u1"), u2: user("u2", "C2"), inactiveUser: user("inactiveUser", "C1", false),
  inactiveSouser: { ...so("inactiveSouser", "B"), isActive: false } };
const loadIdentity = async (id) => identities[id] ?? null;

test("server refuses mixed-organisation group even when its creator is an officer", async () => {
  let created = false;
  const chat = { channel: () => { created = true; } };
  await assert.rejects(createChatChannel("off", { userIds: ["a", "b"], name: "Group" }, { chat, loadIdentity }), { statusCode: 403 });
  assert.equal(created, false);
});
test("server creates a scoped group and derives its creator", async () => {
  let payload;
  const chat = { channel: (type, id, data) => ({ id, create: async () => { payload = { type, ...data }; } }) };
  const result = await createChatChannel("a", { userIds: ["a", "friend", "off"], name: "Team" }, { chat, loadIdentity });
  assert.match(result.channelId, /^grp-/);
  assert.equal(payload.created_by_id, "a");
  assert.deepEqual(payload.members, ["a", "friend", "off"]);
});
test("DM reuse still checks current permissions before querying Stream", async () => {
  let queried = false;
  const chat = { queryChannels: async () => { queried = true; return [{ id: "old" }]; } };
  await assert.rejects(createChatChannel("a", { userIds: ["b"] }, { chat, loadIdentity }), { statusCode: 403 });
  assert.equal(queried, false);
  assert.deepEqual(await createChatChannel("a", { userIds: ["friend"] }, { chat, loadIdentity }), { channelId: "old" });
});
test("adding a member validates against existing members, not just the officer", async () => {
  let added = false;
  const channel = { queryMembers: async () => ({ members: [{ user_id: "off" }, { user_id: "a" }] }), addMembers: async () => { added = true; } };
  await assert.rejects(addScopedChannelMember("off", "group", "b", { chat: { channel: () => channel }, loadIdentity }), { statusCode: 403 });
  assert.equal(added, false);
});
const memberChannel = (ids, added) => ({
  queryMembers: async () => ({ members: ids.map((user_id) => ({ user_id })) }),
  addMembers: async (ids) => added.push(...ids),
});
test("an inactive existing member does not block adding a new member", async () => {
  const added = [];
  const chat = { channel: () => memberChannel(["off", "u1", "inactiveUser", "inactiveSouser"], added) };
  await addScopedChannelMember("off", "group", "u2", { chat, loadIdentity });
  assert.deepEqual(added, ["u2"]);
});
test("a member missing from the DB does not block adding a new member", async () => {
  const added = [];
  const chat = { channel: () => memberChannel(["off", "u1", "ghost"], added) };
  await addScopedChannelMember("off", "group", "u2", { chat, loadIdentity });
  assert.deepEqual(added, ["u2"]);
});
test("an inactive or missing target is still refused", async () => {
  const added = [];
  const chat = { channel: () => memberChannel(["off", "u1"], added) };
  await assert.rejects(addScopedChannelMember("off", "group", "inactiveUser", { chat, loadIdentity }), { statusCode: 403 });
  await assert.rejects(addScopedChannelMember("off", "group", "ghost", { chat, loadIdentity }), { statusCode: 403 });
  assert.deepEqual(added, []);
});
test("SOUSER cross-organisation add is still refused alongside inactive members", async () => {
  const added = [];
  const chat = { channel: () => memberChannel(["off", "a", "inactiveUser", "ghost"], added) };
  await assert.rejects(addScopedChannelMember("off", "group", "b", { chat, loadIdentity }), { statusCode: 403 });
  // Target is a USER, but an active SOUSER member must still share their org with them.
  await assert.rejects(addScopedChannelMember("off", "group", "u1", { chat, loadIdentity }), { statusCode: 403 });
  await addScopedChannelMember("off", "group", "friend", { chat, loadIdentity });
  assert.deepEqual(added, ["friend"]);
});
test("outsider cannot add members through admin SDK", async () => {
  const channel = { queryMembers: async () => ({ members: [{ user_id: "off" }] }) };
  await assert.rejects(addScopedChannelMember("a", "group", "friend", { chat: { channel: () => channel }, loadIdentity }), { statusCode: 403 });
});
test("cleanup visits over 100 channels and does not let an officer mask an invalid member", async () => {
  const removed = [];
  const channels = Array.from({ length: 115 }, (_, i) => ({
    cid: `messaging:${i}`, data: { created_at: "2026-01-01T00:00:00.000000Z" },
    queryMembers: async () => ({ members: [{ user_id: "a" }, { user_id: "off" }, { user_id: i === 114 ? "b" : "friend" }] }),
    removeMembers: async () => removed.push(i),
  }));
  const chat = { queryChannels: async (filter, sort, options) => {
    assert.equal(options.limit, 30);
    return channels.filter((c) => !(filter.cid?.$nin ?? []).includes(c.cid)).slice(0, 30);
  } };
  assert.deepEqual(await pruneOutOfScopeChannels("a", { chat, loadIdentity }), { removed: 1, checked: 115 });
  assert.deepEqual(removed, [114]);
  assert.deepEqual(await pruneOutOfScopeChannels("a", { chat, loadIdentity, dryRun: true }),
    { wouldRemove: 1, checked: 115 });
  assert.deepEqual(removed, [114], "read-only audit must never mutate membership");
});
test("member pagination includes more than 1000 members without offset limits", async () => {
  const all = Array.from({ length: 1105 }, (_, i) => ({ user_id: String(i).padStart(5, "0") }));
  const channel = { queryMembers: async (filter, sort, opts) => ({ members: all.filter((m) => !opts.user_id_gt || m.user_id > opts.user_id_gt).slice(0, opts.limit) }) };
  assert.equal((await listChannelMemberIds(channel)).length, 1105);
});
test("channel request rejects arbitrary identities and excessive group size", () => {
  assert.equal(createChatChannelSchema.safeParse({ userIds: ["not-a-user-id"] }).success, false);
  assert.equal(createChatChannelSchema.safeParse({ userIds: Array(100).fill("00000000-0000-4000-8000-000000000001") }).success, false);
});
