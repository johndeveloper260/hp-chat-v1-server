/**
 * SOUSER scope resolution.
 *
 * Covers the two dimensions every SOUSER authorization decision rests on —
 * sending organisation and authorised business units — including the
 * fail-closed cases, which are the ones that matter most: a scope that is
 * merely absent must deny, never fall through to "unscoped".
 */
import test from "node:test";
import assert from "node:assert/strict";

const {
  isSouser,
  isPrivileged,
  sameSendingOrg,
  normaliseBuAccess,
  buildSouserScope,
  isBuAuthorised,
  canWriteAnnouncements,
} = await import("../utils/souserScope.js");

const scopeOf = (sendingOrg, buAccess) =>
  buildSouserScope({ id: "u1", sendingOrg, buAccess });

// ── Identity ─────────────────────────────────────────────────────────────────

test("isSouser matches the user_type the API reports, in any casing", () => {
  assert.equal(isSouser({ userType: "souser" }), true);
  assert.equal(isSouser({ userType: "SOUSER" }), true);
  assert.equal(isSouser({ userType: "USER" }), false);
  assert.equal(isSouser({ userType: "OFFICER" }), false);
  assert.equal(isSouser({}), false);
  assert.equal(isSouser(null), false);
});

test("isPrivileged is OFFICER and ADMIN only — a SOUSER is never privileged", () => {
  assert.equal(isPrivileged({ userType: "OFFICER" }), true);
  assert.equal(isPrivileged({ userType: "admin" }), true);
  assert.equal(isPrivileged({ userType: "SOUSER" }), false);
  assert.equal(isPrivileged({ userType: "USER" }), false);
});

// ── Sending organisation identity ────────────────────────────────────────────

test("sending orgs compare by exact code — the (code, business_unit) key is case- and space-sensitive", () => {
  assert.equal(sameSendingOrg("GMC", "GMC"), true);
  assert.equal(sameSendingOrg("GMC", "gmc"), false, "case-folding would merge two distinct codes");
  assert.equal(sameSendingOrg("GMC", " GMC"), false, "trimming would merge two distinct codes");
  assert.equal(sameSendingOrg("GMC", "GMC2"), false);
});

test("a missing sending org never matches — including blank against blank", () => {
  assert.equal(sameSendingOrg(null, "GMC"), false);
  assert.equal(sameSendingOrg("GMC", null), false);
  assert.equal(sameSendingOrg(undefined, "GMC"), false);
  assert.equal(sameSendingOrg("", ""), false, "two unset orgs are not the same organisation");
  assert.equal(sameSendingOrg(null, null), false);
});

// ── BU access normalisation ──────────────────────────────────────────────────

test("BU access accepts repository rows or bare codes, and drops empty entries", () => {
  assert.deepEqual(
    normaliseBuAccess([{ business_unit: "FWARD", announcements_write: true }]),
    [{ business_unit: "FWARD", announcements_read: false, announcements_write: true }],
  );
  assert.deepEqual(
    normaliseBuAccess(["FWARD"]),
    [{ business_unit: "FWARD", announcements_read: false, announcements_write: false }],
    "a bare code carries no write permission",
  );
  assert.deepEqual(normaliseBuAccess([null, {}, { business_unit: "" }]), []);
  assert.deepEqual(normaliseBuAccess(null), []);
});

test("announcements_write is only true for a literal true", () => {
  assert.equal(normaliseBuAccess([{ business_unit: "A", announcements_write: "true" }])[0].announcements_write, false);
  assert.equal(normaliseBuAccess([{ business_unit: "A", announcements_write: 1 }])[0].announcements_write, false);
  assert.equal(normaliseBuAccess([{ business_unit: "A", announcements_write: null }])[0].announcements_write, false);
});

// ── Scope construction, and failing closed ───────────────────────────────────

test("a complete scope carries the org and every granted BU", () => {
  const scope = scopeOf("GMC", [
    { business_unit: "FWARD", announcements_write: true },
    { business_unit: "EAST", announcements_write: false },
  ]);
  assert.equal(scope.valid, true);
  assert.equal(scope.reason, null);
  assert.equal(scope.sendingOrg, "GMC");
  assert.deepEqual(scope.businessUnits, ["FWARD", "EAST"]);
  assert.deepEqual(scope.writableBusinessUnits, ["FWARD"]);
});

test("duplicate BU rows collapse to one entry", () => {
  const scope = scopeOf("GMC", [
    { business_unit: "FWARD", announcements_write: false },
    { business_unit: "FWARD", announcements_write: true },
  ]);
  assert.deepEqual(scope.businessUnits, ["FWARD"]);
});

test("FAIL CLOSED: no sending organisation invalidates the whole scope", () => {
  const scope = scopeOf(null, [{ business_unit: "FWARD", announcements_write: true }]);
  assert.equal(scope.valid, false);
  assert.equal(scope.reason, "souser_sending_org_missing");
});

test("FAIL CLOSED: an empty sending organisation is treated as missing, not as a wildcard", () => {
  assert.equal(scopeOf("", [{ business_unit: "FWARD" }]).valid, false);
});

test("FAIL CLOSED: every BU grant revoked leaves no scope", () => {
  const scope = scopeOf("GMC", []);
  assert.equal(scope.valid, false);
  assert.equal(scope.reason, "souser_bu_access_missing");
});

test("FAIL CLOSED: neither dimension present reports the combined reason", () => {
  assert.equal(scopeOf(null, []).reason, "souser_scope_missing");
  assert.equal(buildSouserScope().valid, false);
});

test("FAIL CLOSED: an invalid scope authorises no BU, even one named in its grants", () => {
  const scope = scopeOf(null, [{ business_unit: "FWARD", announcements_write: true }]);
  assert.equal(isBuAuthorised(scope, "FWARD"), false);
  assert.equal(canWriteAnnouncements(scope, "FWARD"), false);
});

// ── BU authorisation ─────────────────────────────────────────────────────────

test("BU authorisation is membership of the grant list, nothing looser", () => {
  const scope = scopeOf("GMC", [{ business_unit: "FWARD" }, { business_unit: "EAST" }]);
  assert.equal(isBuAuthorised(scope, "FWARD"), true);
  assert.equal(isBuAuthorised(scope, "EAST"), true);
  assert.equal(isBuAuthorised(scope, "WEST"), false, "a BU never granted");
  assert.equal(isBuAuthorised(scope, null), false);
  assert.equal(isBuAuthorised(scope, ""), false);
  assert.equal(isBuAuthorised(scope, undefined), false);
});

// ── "Allow bulletin writing" ─────────────────────────────────────────────────

test("bulletin writing is off unless the control is on for that specific BU", () => {
  const scope = scopeOf("GMC", [
    { business_unit: "FWARD", announcements_write: true },
    { business_unit: "EAST", announcements_write: false },
  ]);
  assert.equal(canWriteAnnouncements(scope, "FWARD"), true);
  assert.equal(canWriteAnnouncements(scope, "EAST"), false);
});

test("the control defaults to off when no BU grant carries it", () => {
  const scope = scopeOf("GMC", [{ business_unit: "FWARD" }]);
  assert.equal(isBuAuthorised(scope, "FWARD"), true, "reading access is unaffected");
  assert.equal(canWriteAnnouncements(scope, "FWARD"), false);
});

test("turning the control off removes writing but leaves the BU authorised for reading", () => {
  const on  = scopeOf("GMC", [{ business_unit: "FWARD", announcements_write: true }]);
  const off = scopeOf("GMC", [{ business_unit: "FWARD", announcements_write: false }]);

  assert.equal(canWriteAnnouncements(on, "FWARD"), true);
  assert.equal(canWriteAnnouncements(off, "FWARD"), false);
  assert.equal(isBuAuthorised(off, "FWARD"), true,
    "disabling writing must not cost the account its reading access");
});

test("writing is denied in a revoked BU even while the account-level control is on elsewhere", () => {
  // The officer revoked EAST; FWARD still carries the write flag.
  const scope = scopeOf("GMC", [{ business_unit: "FWARD", announcements_write: true }]);
  assert.equal(canWriteAnnouncements(scope, "FWARD"), true);
  assert.equal(canWriteAnnouncements(scope, "EAST"), false,
    "a revoked BU has no row, so it cannot satisfy the per-BU check");
});

test("Read and Write control bulletin access without changing organisation or BU membership", () => {
  const off = scopeOf("A", [{ business_unit: "BU", announcements_read: false, announcements_write: false }]);
  const read = scopeOf("A", [{ business_unit: "BU", announcements_read: true, announcements_write: false }]);
  const write = scopeOf("A", [{ business_unit: "BU", announcements_read: false, announcements_write: true }]);
  assert.deepEqual(off.businessUnits, read.businessUnits);
  assert.equal(read.sendingOrg, off.sendingOrg);
  assert.deepEqual(off.readableBusinessUnits, []);
  assert.deepEqual(read.readableBusinessUnits, ["BU"]);
  assert.deepEqual(read.writableBusinessUnits, []);
  assert.deepEqual(write.readableBusinessUnits, ["BU"]);
  assert.deepEqual(write.writableBusinessUnits, ["BU"]);
});
