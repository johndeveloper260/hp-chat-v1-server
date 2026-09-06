/**
 * SO User account management SQL.
 *
 * The two defects here were silent: deactivation wrote a column nothing
 * enforces, and re-granting a revoked BU did nothing at all. Both are shaped by
 * the statement rather than by any JS branch, so these assert on the statement.
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

const souserRepo = await import("../repositories/souserRepository.js");

const recorder = (rows = []) => {
  const calls = [];
  return { calls, query: async (text, values) => (calls.push({ text, values }), { rows, rowCount: rows.length }) };
};

// ── Deactivation ─────────────────────────────────────────────────────────────

test("deactivation writes user_account_tbl.is_active — the column login and auth enforce", async () => {
  const db = recorder([{ id: "so-1", is_active: false }]);
  await souserRepo.setActive("so-1", false, "off-1", db);

  const { text, values } = db.calls[0];
  assert.match(text, /UPDATE v4\.user_account_tbl[\s\S]*SET is_active = \$2/,
    "the old toggle only wrote souser_tbl, which nothing checks");
  assert.deepEqual(values, ["so-1", false, "off-1"]);
});

test("deactivation keeps souser_tbl.is_active in step, in one statement", async () => {
  const db = recorder([{ id: "so-1", is_active: false }]);
  await souserRepo.setActive("so-1", false, "off-1", db);

  const { text } = db.calls[0];
  assert.match(text, /UPDATE v4\.souser_tbl/);
  assert.equal(db.calls.length, 1, "one statement — the two columns cannot drift apart");
});

test("activation is an explicit target, so a repeated submit is idempotent", async () => {
  const db = recorder([{ id: "so-1", is_active: true }]);
  await souserRepo.setActive("so-1", true, "off-1", db);
  await souserRepo.setActive("so-1", true, "off-1", db);

  assert.doesNotMatch(db.calls[0].text, /NOT is_active/,
    "flipping would reactivate the account on the second submit");
  assert.equal(db.calls[0].values[1], true);
  assert.equal(db.calls[1].values[1], true);
});

test("the officer performing the change is recorded", async () => {
  const db = recorder([{ id: "so-1", is_active: false }]);
  await souserRepo.setActive("so-1", false, "off-7", db);
  assert.match(db.calls[0].text, /updated_by = \$3/);
  assert.equal(db.calls[0].values[2], "off-7");
});

// ── Re-granting a revoked BU ─────────────────────────────────────────────────

test("re-granting a revoked BU clears the revocation instead of doing nothing", async () => {
  const db = recorder([{ business_unit: "EAST" }]);
  await souserRepo.insertBuAccess("so-1", "EAST", "off-1", false, db);

  const { text } = db.calls[0];
  assert.match(text, /ON CONFLICT \(souser_id, business_unit\) DO UPDATE/);
  assert.match(text, /revoked_at\s*=\s*NULL/);
  assert.match(text, /revoked_by\s*=\s*NULL/);
  assert.doesNotMatch(text, /DO NOTHING/,
    "revoking keeps the row, so DO NOTHING made every re-grant a no-op");
});

test("a re-grant re-stamps who granted it and when", async () => {
  const db = recorder([{ business_unit: "EAST" }]);
  await souserRepo.insertBuAccess("so-1", "EAST", "off-2", false, db);

  assert.match(db.calls[0].text, /granted_at\s*=\s*NOW\(\)/);
  assert.match(db.calls[0].text, /granted_by\s*=\s*EXCLUDED\.granted_by/);
  assert.equal(db.calls[0].values[2], "off-2");
});

test("a grant carries its write permission explicitly, so a stale flag cannot be resurrected", async () => {
  const db = recorder([{ business_unit: "EAST" }]);
  await souserRepo.insertBuAccess("so-1", "EAST", "off-1", false, db);
  assert.equal(db.calls[0].values[3], false);

  await souserRepo.insertBuAccess("so-1", "EAST", "off-1", true, db);
  assert.equal(db.calls[1].values[3], true);
  assert.match(db.calls[1].text, /announcements_write\s*=\s*EXCLUDED\.announcements_write/);
});

test("bulletin writing defaults to off when a grant does not name it", async () => {
  const db = recorder([{ business_unit: "EAST" }]);
  await souserRepo.insertBuAccess("so-1", "EAST", "off-1", undefined, db);
  assert.equal(db.calls[0].values[3], false);
});

test("a non-boolean write value is coerced to off, never to on", async () => {
  const db = recorder([{ business_unit: "EAST" }]);
  for (const value of ["true", 1, {}, null]) {
    await souserRepo.insertBuAccess("so-1", "EAST", "off-1", value, db);
  }
  for (const call of db.calls) assert.equal(call.values[3], false);
});

// ── Revocation ───────────────────────────────────────────────────────────────

test("revoking marks the row rather than deleting it, and only a live grant", async () => {
  const db = recorder();
  await souserRepo.revokeBuAccess("so-1", "EAST", "off-1", db);

  const { text, values } = db.calls[0];
  assert.match(text, /SET revoked_at = CURRENT_TIMESTAMP/);
  assert.match(text, /revoked_at IS NULL/, "re-revoking must not overwrite the original timestamp");
  assert.deepEqual(values, ["so-1", "EAST", "off-1"]);
});

// ── "Allow bulletin writing" ─────────────────────────────────────────────────

test("the account-level control writes every live BU grant at once", async () => {
  const db = recorder([{ business_unit: "FWARD" }, { business_unit: "EAST" }]);
  const { rows } = await souserRepo.setAnnouncementsWriteForAccount("so-1", true, db);

  const { text, values } = db.calls[0];
  assert.match(text, /WHERE souser_id = \$1 AND revoked_at IS NULL/,
    "a revoked BU must not be granted writing by an account-level switch");
  assert.doesNotMatch(text, /business_unit = \$/);
  assert.deepEqual(values, ["so-1", true]);
  assert.equal(rows.length, 2, "the touched BUs come back so the UI can name them");
});

test("turning the control off touches permissions only, never the bulletins", async () => {
  const db = recorder([]);
  await souserRepo.setAnnouncementsWriteForAccount("so-1", false, db);

  const { text, values } = db.calls[0];
  assert.equal(values[1], false);
  assert.match(text, /UPDATE v4\.souser_bu_access_tbl/);
  assert.doesNotMatch(text, /announcement_tbl/,
    "existing bulletins and reading access must survive the change");
});

test("the control is only enabled by a literal true", async () => {
  const db = recorder([]);
  for (const value of ["true", 1, "on", null, undefined]) {
    await souserRepo.setAnnouncementsWriteForAccount("so-1", value, db);
  }
  for (const call of db.calls) assert.equal(call.values[1], false);
});

test("the enabled check looks for a live grant carrying the flag", async () => {
  const db = recorder([{ "?column?": 1 }]);
  assert.equal(await souserRepo.isAnnouncementsWriteEnabled("so-1", db), true);
  assert.match(db.calls[0].text, /revoked_at IS NULL AND announcements_write = true/);

  const empty = recorder([]);
  assert.equal(await souserRepo.isAnnouncementsWriteEnabled("so-1", empty), false);
});

// ── Management scoping ───────────────────────────────────────────────────────

test("an officer resolves a target only inside their own business unit", async () => {
  const db = recorder([{ id: "so-1" }]);
  await souserRepo.findByIdInBU("so-1", "FWARD", db);

  const { text, values } = db.calls[0];
  assert.match(text, /s\.primary_bu = \$2/,
    "without this the bare :id routes reach every BU in the platform");
  assert.deepEqual(values, ["so-1", "FWARD"]);
});

test("the management lookup reports the enforced active flag, not just the display one", async () => {
  const db = recorder([{ id: "so-1" }]);
  await souserRepo.findByIdInBU("so-1", "FWARD", db);
  assert.match(db.calls[0].text, /u\.is_active AS account_is_active/);
});

// ── BU list ──────────────────────────────────────────────────────────────────

test("the active BU list excludes revoked grants and carries their permissions", async () => {
  const db = recorder([{ business_unit: "FWARD", announcements_write: true }]);
  await souserRepo.findActiveBuList("so-1", db);

  const { text } = db.calls[0];
  assert.match(text, /revoked_at IS NULL/);
  assert.match(text, /announcements_write/);
});

// ── Deletion ─────────────────────────────────────────────────────────────────

test("deletion removes grants, profile and account, in foreign-key order, on one connection", async () => {
  const db = recorder();
  await souserRepo.deleteSouser("so-1", db);

  assert.equal(db.calls.length, 3);
  assert.match(db.calls[0].text, /DELETE FROM v4\.souser_bu_access_tbl/);
  assert.match(db.calls[1].text, /DELETE FROM v4\.souser_tbl/);
  assert.match(db.calls[2].text, /DELETE FROM v4\.user_account_tbl/);
  // All three share the caller's client, so they commit or roll back together.
  for (const call of db.calls) assert.deepEqual(call.values, ["so-1"]);
});

// ── Creation ─────────────────────────────────────────────────────────────────

test("a new account starts inactive until its password is set", async () => {
  const db = recorder([{ id: "new-1" }]);
  await souserRepo.insertUserAccount("a@example.com", "FWARD", db);
  assert.match(db.calls[0].text, /is_active\s*\)\s*VALUES \(\$1, \$2, false\)/);

  const pwDb = recorder();
  await souserRepo.setPasswordHash("new-1", "hash", pwDb);
  assert.match(pwDb.calls[0].text, /password_hash = \$2, is_active = true/);
});

test("an officer's password reset does not flip the account's active state", async () => {
  const db = recorder();
  await souserRepo.updatePasswordHash("so-1", "hash", db);
  assert.doesNotMatch(db.calls[0].text, /is_active/,
    "resetting the password of a deactivated account must not reactivate it");
});
