/**
 * Announcement SQL construction.
 *
 * The feed, the notification fan-out and the audience preview all decide who
 * sees a bulletin in SQL, so the JS predicate tests cannot reach them. There is
 * no DB fixture harness in this repo, so these pass a recording stand-in for the
 * pg client — the repository functions already take an optional `client` — and
 * assert on the statement and the bound parameters that would have been sent.
 *
 * What that catches: a missing BU bound, a targeting filter silently dropped, a
 * value interpolated instead of parameterised.
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

const feedRepo = await import("../repositories/feedRepository.js");

/** Records what would have been sent to Postgres and returns a canned result. */
const recorder = (rows = []) => {
  const calls = [];
  return {
    calls,
    query: async (text, values) => {
      calls.push({ text, values });
      return { rows, rowCount: rows.length };
    },
  };
};

const feedArgs = (over = {}) => ({
  lang: "en",
  userId: "u-1",
  company_filter: null,
  businessUnits: ["FWARD"],
  isOfficer: false,
  isManagement: false,
  souser: null,
  ...over,
});

// ── Feed: business unit boundary ─────────────────────────────────────────────

test("the feed always binds the BU list as a parameter", async () => {
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({ businessUnits: ["FWARD", "EAST"], client: db }));

  const { text, values } = db.calls[0];
  assert.match(text, /a\.business_unit = ANY\(\$\d+::text\[\]\)/);
  assert.deepEqual(values.at(-1), ["FWARD", "EAST"]);
});

test("FAIL CLOSED: an empty BU list returns nothing and never reaches the database", async () => {
  const db = recorder([{ row_id: 1 }]);
  const rows = await feedRepo.findAnnouncements(feedArgs({ businessUnits: [], client: db }));

  assert.deepEqual(rows, []);
  assert.equal(db.calls.length, 0, "a scopeless caller must not run an unbounded query");
});

test("FAIL CLOSED: null and blank BU entries are dropped, not passed through", async () => {
  const db = recorder();
  const rows = await feedRepo.findAnnouncements(feedArgs({ businessUnits: [null, "", undefined], client: db }));
  assert.deepEqual(rows, []);
  assert.equal(db.calls.length, 0);
});

// ── Feed: SOUSER branch ──────────────────────────────────────────────────────

test("a SOUSER feed binds their sending org and country, and keys on the author org", async () => {
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({
    souser: { sendingOrg: "ALPHA", country: "PH" }, client: db,
  }));

  const { text, values } = db.calls[0];
  assert.match(text, /a\.created_by_sending_org IS NOT NULL/);
  assert.ok(values.includes("ALPHA"), "the sending org must be bound, not inlined");
  assert.ok(values.includes("PH"));
  assert.doesNotMatch(text, /'ALPHA'/);
});

test("a SOUSER feed does not join the requester profile row for its decision", async () => {
  // A SOUSER has no user_profile_tbl row, so the USER branch would compare
  // against NULLs and quietly widen or empty the feed.
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({
    souser: { sendingOrg: "ALPHA", country: "PH" }, client: db,
  }));
  const where = db.calls[0].text.split("WHERE 1=1")[1];
  assert.doesNotMatch(where, /requester\./);
});

test("a SOUSER with no country still produces a valid query, binding null", async () => {
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({
    souser: { sendingOrg: "ALPHA", country: null }, client: db,
  }));
  assert.ok(db.calls[0].values.includes(null));
});

// ── Feed: officer and user branches ──────────────────────────────────────────

test("the officer branch keeps its BU bound and adds no targeting filters", async () => {
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({ isOfficer: true, client: db }));

  const where = db.calls[0].text.split("WHERE 1=1")[1];
  assert.match(where, /a\.business_unit = ANY/);
  assert.doesNotMatch(where, /created_by_sending_org/);
});

test("the officer management view drops the active/date window; the home feed keeps it", async () => {
  const mgmt = recorder();
  await feedRepo.findAnnouncements(feedArgs({ isOfficer: true, isManagement: true, client: mgmt }));
  assert.doesNotMatch(mgmt.calls[0].text.split("WHERE 1=1")[1], /a\.active = true/);

  const home = recorder();
  await feedRepo.findAnnouncements(feedArgs({ isOfficer: true, isManagement: false, client: home }));
  assert.match(home.calls[0].text.split("WHERE 1=1")[1], /a\.active = true/);
});

test("the USER branch restricts SOUSER-authored posts to the requester's own organisation", async () => {
  const db = recorder();
  await feedRepo.findAnnouncements(feedArgs({ client: db }));

  const where = db.calls[0].text.split("WHERE 1=1")[1];
  assert.match(where, /requester\.sending_org = a\.created_by_sending_org/);
});

// ── Notification fan-out ─────────────────────────────────────────────────────

test("a SOUSER-authored post notifies only that organisation, employees and SOUSERs alike", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "so-1", null, ["PH"], "ALPHA", "ALPHA", db);

  const { text, values } = db.calls[0];
  assert.equal(values.filter((v) => v === "ALPHA").length, 1, "one bound org, reused by both branches");
  assert.match(text, /p\.sending_org = \$3/, "employees of the organisation");
  assert.match(text, /su\.sending_org = \$3/, "fellow SOUSERs of the organisation");
  assert.doesNotMatch(text, /p\.country/, "country must not narrow an organisation post");
  assert.doesNotMatch(text, /p\.company/);
});

test("the SOUSER recipient branch re-checks live BU access, so a revoked grant stops notifications", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "so-1", null, null, null, "ALPHA", db);

  assert.match(db.calls[0].text, /souser_bu_access_tbl[\s\S]*revoked_at IS NULL/);
});

test("recipients are always restricted to the announcement's BU and exclude the author", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "author-1", null, null, null, "ALPHA", db);

  const { text, values } = db.calls[0];
  assert.equal(values[0], "FWARD");
  assert.equal(values[1], "author-1");
  assert.match(text, /a\.business_unit = \$1::text/);
  assert.match(text, /a\.id != \$2::uuid/);
});

test("a general post keeps its company, country and sending_org targeting for employees", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "off-1", ["company-1"], ["PH"], "ALPHA", null, db);

  const { text, values } = db.calls[0];
  assert.match(text, /p\.company::uuid = ANY/);
  assert.match(text, /p\.country = ANY/);
  assert.match(text, /p\.sending_org = /);
  assert.deepEqual(values[2], ["company-1"]);
  assert.deepEqual(values[3], ["PH"]);
  assert.equal(values[4], "ALPHA");
});

test("a company-targeted general post notifies no SOUSER, who belongs to no company", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "off-1", ["company-1"], null, null, null, db);

  const souserBranch = db.calls[0].text.split("souser_tbl")[1];
  assert.match(souserBranch, /AND false/);
});

test("deactivated accounts are never notified", async () => {
  const db = recorder();
  await feedRepo.findRecipientIds("FWARD", "off-1", null, null, null, "ALPHA", db);
  const branches = db.calls[0].text.split("UNION");
  assert.equal(branches.length, 3);
  for (const branch of branches) assert.match(branch, /is_active = true/);
});

// ── Audience preview ─────────────────────────────────────────────────────────

test("a SOUSER audience preview counts their own organisation only", async () => {
  const db = recorder([{ count: "12" }]);
  const result = await feedRepo.countAudience("FWARD", null, null, null, null, "ALPHA", db);

  const { text, values } = db.calls[0];
  assert.deepEqual(values, ["FWARD", "ALPHA"]);
  assert.match(text, /p\.sending_org = \$2/);
  assert.match(text, /su\.sending_org = \$2/);
  assert.doesNotMatch(text, /user_type\) IN \('officer', 'admin'\)/,
    "the officer branch would inflate the count past the real audience");
  assert.deepEqual(result, { count: 12, officers_only: false });
});

test("BYPASS: submitted audience fields are ignored once an author org is supplied", async () => {
  const db = recorder([{ count: "3" }]);
  await feedRepo.countAudience(
    "FWARD", ["company-someone-elses"], "batch-9", ["JP"], "BETA", "ALPHA", db,
  );

  const { values } = db.calls[0];
  assert.deepEqual(values, ["FWARD", "ALPHA"],
    "nothing the caller submitted may reach the query");
});

test("the officer audience preview is unchanged", async () => {
  const db = recorder([{ count: "40", regular_count: "35" }]);
  const result = await feedRepo.countAudience("FWARD", ["company-1"], null, null, null, null, db);

  assert.match(db.calls[0].text, /LOWER\(p\.user_type\) IN \('officer', 'admin'\)/);
  assert.deepEqual(result, { count: 40, officers_only: false });
});

// ── Poster filter ────────────────────────────────────────────────────────────

test("the SOUSER poster list is bounded by their BUs and their organisation", async () => {
  const db = recorder();
  await feedRepo.findPostersForSendingOrg(["FWARD", "EAST"], "ALPHA", db);

  const { text, values } = db.calls[0];
  assert.deepEqual(values, [["FWARD", "EAST"], "ALPHA"]);
  assert.match(text, /a\.created_by_sending_org = \$2/);
});

test("FAIL CLOSED: the poster list is empty without a BU or an organisation", async () => {
  const db = recorder([{ value: "x" }]);
  assert.deepEqual(await feedRepo.findPostersForSendingOrg([], "ALPHA", db), []);
  assert.deepEqual(await feedRepo.findPostersForSendingOrg(["FWARD"], null, db), []);
  assert.equal(db.calls.length, 0);
});

// ── Single-record lookup ─────────────────────────────────────────────────────

test("the visibility lookup is not BU-filtered — it must return the row's real BU to compare", async () => {
  const db = recorder([{ row_id: 1, business_unit: "EAST" }]);
  await feedRepo.findAnnouncementForVisibility(1, db);

  const { text, values } = db.calls[0];
  assert.deepEqual(values, [1]);
  assert.match(text, /WHERE row_id = \$1::integer/);
  assert.doesNotMatch(text, /business_unit = \$/,
    "filtering here would hide the BU mismatch instead of reporting it");
  assert.match(text, /created_by_sending_org/);
  assert.match(text, /created_by/);
});
