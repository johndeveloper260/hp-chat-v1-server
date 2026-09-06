/**
 * Chat access.
 *
 * Who may start a conversation with whom, and what the contact queries bind.
 * The clients build their user pickers from Stream's own queryUsers with
 * client-side filters, so this is the layer that actually decides — every
 * membership change goes through canChat().
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.DB_HOST ??= "test";
process.env.DB_USER ??= "test";
process.env.DB_PASS ??= "test";
process.env.DB_DATABASE ??= "test";
process.env.SECRET_TOKEN ??= "test";
process.env.STREAM_API_KEY ??= "test";
process.env.STREAM_API_SECRET ??= "test";

const { canChat } = await import("../services/chatAccessService.js");
const chatRepo = await import("../repositories/chatAccessRepository.js");

const recorder = (rows = []) => {
  const calls = [];
  return { calls, query: async (text, values) => (calls.push({ text, values }), { rows }) };
};

// ALPHA and BETA both operate in FWARD; ALPHA also operates in EAST.
const so = (id, org, bus = ["FWARD"]) => ({
  id, userType: "SOUSER", isActive: true,
  businessUnit: bus[0], businessUnits: bus, sendingOrg: org, isPrivileged: false,
});
const emp = (id, org, bu = "FWARD") => ({
  id, userType: "USER", isActive: true,
  businessUnit: bu, businessUnits: [bu], sendingOrg: org, company: "company-a", isPrivileged: false,
});
const off = (id, bu = "FWARD") => ({
  id, userType: "OFFICER", isActive: true,
  businessUnit: bu, businessUnits: [bu], sendingOrg: null, isPrivileged: true,
});

// ── Two organisations in one business unit ───────────────────────────────────

test("a SOUSER may chat with an employee of their own sending organisation", () => {
  assert.equal(canChat(so("so-a", "ALPHA"), emp("e-a", "ALPHA")), true);
});

test("a SOUSER may NOT chat with an employee of the other organisation in the same BU", () => {
  assert.equal(canChat(so("so-a", "ALPHA"), emp("e-b", "BETA")), false);
});

test("the block is symmetric — the other organisation's employee cannot reach in either", () => {
  assert.equal(canChat(emp("e-b", "BETA"), so("so-a", "ALPHA")), false);
});

test("two SOUSERs of different organisations cannot chat", () => {
  assert.equal(canChat(so("so-a", "ALPHA"), so("so-b", "BETA")), false);
});

test("two SOUSERs of the same organisation can", () => {
  assert.equal(canChat(so("so-a1", "ALPHA"), so("so-a2", "ALPHA")), true);
});

// ── Coordinator contact ──────────────────────────────────────────────────────

test("a SOUSER may contact a coordinator in an authorised BU", () => {
  assert.equal(canChat(so("so-a", "ALPHA"), off("off-1", "FWARD")), true);
  assert.equal(canChat(off("off-1", "FWARD"), so("so-a", "ALPHA")), true);
});

test("a coordinator outside every authorised BU is still out of reach", () => {
  assert.equal(canChat(so("so-a", "ALPHA", ["FWARD"]), off("off-2", "WEST")), false);
});

test("a coordinator reaches both organisations in their own BU", () => {
  assert.equal(canChat(off("off-1", "FWARD"), so("so-a", "ALPHA")), true);
  assert.equal(canChat(off("off-1", "FWARD"), so("so-b", "BETA")), true);
});

// ── Business unit boundaries ─────────────────────────────────────────────────

test("a multi-BU SOUSER reaches their organisation in each authorised BU", () => {
  const multi = so("so-a", "ALPHA", ["FWARD", "EAST"]);
  assert.equal(canChat(multi, emp("e-1", "ALPHA", "FWARD")), true);
  assert.equal(canChat(multi, emp("e-2", "ALPHA", "EAST")), true);
});

test("a BU that was never granted stays out of reach, same organisation or not", () => {
  const multi = so("so-a", "ALPHA", ["FWARD", "EAST"]);
  assert.equal(canChat(multi, emp("e-3", "ALPHA", "WEST")), false);
});

test("revoking a BU cuts contact with everyone who was only reachable through it", () => {
  const before = so("so-a", "ALPHA", ["FWARD", "EAST"]);
  const after  = so("so-a", "ALPHA", ["FWARD"]);
  const target = emp("e-2", "ALPHA", "EAST");

  assert.equal(canChat(before, target), true);
  assert.equal(canChat(after, target), false);
});

// ── Deactivation ─────────────────────────────────────────────────────────────

test("a deactivated account can neither start nor receive a conversation", () => {
  const dead = { ...so("so-a", "ALPHA"), isActive: false };
  assert.equal(canChat(dead, emp("e-a", "ALPHA")), false);
  assert.equal(canChat(emp("e-a", "ALPHA"), dead), false);
});

test("deactivation beats the coordinator bypass", () => {
  const deadOfficer = { ...off("off-1"), isActive: false };
  assert.equal(canChat(so("so-a", "ALPHA"), deadOfficer), false);
  assert.equal(canChat(deadOfficer, so("so-a", "ALPHA")), false);
});

// ── Fail closed ──────────────────────────────────────────────────────────────

test("FAIL CLOSED: a SOUSER with no sending organisation reaches no one but coordinators", () => {
  const noOrg = so("so-x", null);
  assert.equal(canChat(noOrg, emp("e-a", "ALPHA")), false);
  assert.equal(canChat(noOrg, so("so-a", "ALPHA")), false);
  assert.equal(canChat(noOrg, off("off-1")), true, "they still need their coordinator");
});

test("FAIL CLOSED: a SOUSER with no authorised BU reaches no one at all", () => {
  const noBu = { ...so("so-x", "ALPHA"), businessUnit: null, businessUnits: [] };
  assert.equal(canChat(noBu, emp("e-a", "ALPHA")), false);
  assert.equal(canChat(noBu, off("off-1")), false);
});

test("FAIL CLOSED: an unknown account on either side is denied", () => {
  assert.equal(canChat(null, emp("e-a", "ALPHA")), false);
  assert.equal(canChat(so("so-a", "ALPHA"), null), false);
});

test("an account is never a contact of itself", () => {
  assert.equal(canChat(so("so-a", "ALPHA"), so("so-a", "ALPHA")), false);
});

// ── Unchanged behaviour for ordinary employees ───────────────────────────────

test("two employees in one BU still chat regardless of sending organisation", () => {
  assert.equal(canChat(emp("e-a", "ALPHA"), emp("e-b", "BETA")), true);
  assert.equal(canChat(emp("e-a", null), emp("e-b", null)), true);
});

test("employees in different BUs still cannot", () => {
  assert.equal(canChat(emp("e-a", "ALPHA", "FWARD"), emp("e-b", "ALPHA", "WEST")), false);
});

// ── Contact queries ──────────────────────────────────────────────────────────

test("the SOUSER contact query binds the BU list and the organisation", async () => {
  const db = recorder();
  await chatRepo.findSouserContacts(
    { businessUnits: ["FWARD", "EAST"], sendingOrg: "ALPHA", search: null }, db,
  );

  const { text, values } = db.calls[0];
  assert.deepEqual(values[0], ["FWARD", "EAST"]);
  assert.equal(values[1], "ALPHA");
  assert.equal(values[2], null);
  assert.match(text, /p\.sending_org = \$2/, "employees of the organisation");
  assert.match(text, /su\.sending_org = \$2/, "fellow SOUSERs of the organisation");
  assert.match(text, /IN \('OFFICER', 'ADMIN'\)/, "coordinators, not org-filtered");
});

test("the SOUSER contact query excludes deactivated accounts in every branch", async () => {
  const db = recorder();
  await chatRepo.findSouserContacts({ businessUnits: ["FWARD"], sendingOrg: "ALPHA" }, db);
  const branches = db.calls[0].text.split("UNION");
  assert.equal(branches.length, 3);
  for (const branch of branches) assert.match(branch, /is_active = true/);
});

test("FAIL CLOSED: the SOUSER contact query runs nothing without a BU or an organisation", async () => {
  const db = recorder([{ id: "leak" }]);
  assert.deepEqual(await chatRepo.findSouserContacts({ businessUnits: [], sendingOrg: "ALPHA" }, db), []);
  assert.deepEqual(await chatRepo.findSouserContacts({ businessUnits: ["FWARD"], sendingOrg: null }, db), []);
  assert.equal(db.calls.length, 0);
});

test("search is bound as a parameter, never interpolated", async () => {
  const db = recorder();
  await chatRepo.findSouserContacts(
    { businessUnits: ["FWARD"], sendingOrg: "ALPHA", search: "o'brien" }, db,
  );
  assert.equal(db.calls[0].values[2], "%o'brien%");
  assert.doesNotMatch(db.calls[0].text, /o'brien/);
});

test("an employee sees SOUSERs of their own organisation only; an officer sees all of them", async () => {
  const empDb = recorder();
  await chatRepo.findStandardContacts(
    { businessUnit: "FWARD", sendingOrg: "ALPHA", isPrivileged: false }, empDb,
  );
  assert.equal(empDb.calls[0].values[1], "ALPHA");
  assert.equal(empDb.calls[0].values[2], false);
  assert.match(empDb.calls[0].text, /\$3::boolean OR su\.sending_org = \$2/);

  const offDb = recorder();
  await chatRepo.findStandardContacts(
    { businessUnit: "FWARD", sendingOrg: null, isPrivileged: true }, offDb,
  );
  assert.equal(offDb.calls[0].values[2], true);
});

test("the standard contact query only ever binds one BU — its own", async () => {
  const db = recorder();
  await chatRepo.findStandardContacts({ businessUnit: "FWARD", isPrivileged: false }, db);
  assert.equal(db.calls[0].values[0], "FWARD");
  assert.match(db.calls[0].text, /a\.business_unit = \$1/);
});

test("FAIL CLOSED: no business unit means no contacts and no query", async () => {
  const db = recorder([{ id: "leak" }]);
  assert.deepEqual(await chatRepo.findStandardContacts({ businessUnit: null }, db), []);
  assert.equal(db.calls.length, 0);
});

test("the chat identity lookup reads live BU grants, not the token", async () => {
  const db = recorder([{ id: "u1" }]);
  await chatRepo.findChatIdentity("u1", db);
  assert.match(db.calls[0].text, /souser_bu_access_tbl[\s\S]*revoked_at IS NULL/);
  assert.match(db.calls[0].text, /a\.is_active/);
});
