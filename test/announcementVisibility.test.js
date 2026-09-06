/**
 * Bulletin visibility.
 *
 * canViewAnnouncement() is the single rule behind the feed, the detail view,
 * comments, reactions, attachments, viewers and mark-seen. These cases are the
 * ones the SOUSER work turns on:
 *
 *   two sending organisations inside one business unit
 *   one SOUSER authorised across several business units
 *   a missing scope (must deny, not fall through)
 *   country never restricting on its own
 *   ownership of a bulletin
 */
import test from "node:test";
import assert from "node:assert/strict";

const {
  canViewAnnouncement,
  ownsAnnouncement,
  isWithinFeedWindow,
  souserFeedPredicate,
  userFeedPredicate,
} = await import("../utils/announcementVisibility.js");

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Two organisations, ALPHA and BETA, both sending workers into business unit
// FWARD. ALPHA also operates in EAST.

const souser = (over = {}) => ({
  id: "so-alpha-1", userType: "SOUSER",
  businessUnit: "FWARD", businessUnits: ["FWARD"],
  sendingOrg: "ALPHA", country: "PH", company: null, ...over,
});

const employee = (over = {}) => ({
  id: "emp-1", userType: "USER",
  businessUnit: "FWARD", businessUnits: ["FWARD"],
  sendingOrg: "ALPHA", country: "PH", company: "company-1", ...over,
});

const officer = (over = {}) => ({
  id: "off-1", userType: "OFFICER",
  businessUnit: "FWARD", businessUnits: ["FWARD"],
  sendingOrg: null, country: null, company: null, ...over,
});

/** A bulletin written by a SOUSER of `org`. */
const souserPost = (over = {}) => ({
  row_id: 1, business_unit: "FWARD",
  created_by: "so-alpha-1", created_by_sending_org: "ALPHA",
  sending_org: "ALPHA", country: ["PH"], company: null,
  active: true, date_from: null, date_to: null, ...over,
});

/** A general bulletin written by an officer. */
const generalPost = (over = {}) => ({
  row_id: 2, business_unit: "FWARD",
  created_by: "off-1", created_by_sending_org: null,
  sending_org: null, country: null, company: null,
  active: true, date_from: null, date_to: null, ...over,
});

// ── Two organisations in one business unit ───────────────────────────────────

test("a SOUSER sees a bulletin written by their own organisation", () => {
  assert.equal(canViewAnnouncement(souser(), souserPost()), true);
});

test("a SOUSER does NOT see the other organisation's bulletin in the same BU", () => {
  const beta = souser({ id: "so-beta-1", sendingOrg: "BETA" });
  assert.equal(canViewAnnouncement(beta, souserPost()), false);
});

test("an employee of the authoring organisation sees its bulletin", () => {
  assert.equal(canViewAnnouncement(employee(), souserPost()), true);
});

test("an employee of the other organisation does not, though they share the BU", () => {
  assert.equal(canViewAnnouncement(employee({ sendingOrg: "BETA" }), souserPost()), false);
});

test("an employee with no sending organisation cannot see an organisation's bulletin", () => {
  assert.equal(canViewAnnouncement(employee({ sendingOrg: null }), souserPost()), false);
});

test("the officer bypass reaches a SOUSER bulletin in their own BU, for moderation", () => {
  assert.equal(canViewAnnouncement(officer(), souserPost()), true);
});

test("the officer bypass does NOT reach another BU — it is bounded, not global", () => {
  assert.equal(canViewAnnouncement(officer({ businessUnit: "EAST", businessUnits: ["EAST"] }), souserPost()), false);
});

// ── Business unit boundaries ─────────────────────────────────────────────────

test("a SOUSER authorised in several BUs sees their organisation's bulletins in each", () => {
  const multi = souser({ businessUnits: ["FWARD", "EAST"] });
  assert.equal(canViewAnnouncement(multi, souserPost({ business_unit: "FWARD" })), true);
  assert.equal(canViewAnnouncement(multi, souserPost({ business_unit: "EAST" })), true);
});

test("a BU the SOUSER was never granted stays out of reach, same organisation or not", () => {
  const multi = souser({ businessUnits: ["FWARD", "EAST"] });
  assert.equal(canViewAnnouncement(multi, souserPost({ business_unit: "WEST" })), false);
  assert.equal(canViewAnnouncement(multi, generalPost({ business_unit: "WEST" })), false);
});

test("revoking a BU removes it from the scope and with it the bulletins", () => {
  const before = souser({ businessUnits: ["FWARD", "EAST"] });
  const after  = souser({ businessUnits: ["FWARD"] });   // EAST revoked
  const post   = souserPost({ business_unit: "EAST" });

  assert.equal(canViewAnnouncement(before, post), true);
  assert.equal(canViewAnnouncement(after, post), false);
});

// ── Fail closed ──────────────────────────────────────────────────────────────

test("FAIL CLOSED: a SOUSER with no authorised BU sees nothing", () => {
  const noScope = souser({ businessUnit: null, businessUnits: [] });
  assert.equal(canViewAnnouncement(noScope, souserPost()), false);
  assert.equal(canViewAnnouncement(noScope, generalPost()), false);
});

test("FAIL CLOSED: a SOUSER with no sending organisation sees no organisation bulletin", () => {
  const noOrg = souser({ sendingOrg: null });
  assert.equal(canViewAnnouncement(noOrg, souserPost()), false);
});

test("FAIL CLOSED: a missing viewer or bulletin is never visible", () => {
  assert.equal(canViewAnnouncement(null, souserPost()), false);
  assert.equal(canViewAnnouncement(souser(), null), false);
  assert.equal(canViewAnnouncement(souser(), undefined), false);
});

// ── Country must not restrict on its own ─────────────────────────────────────

test("country does not narrow an organisation bulletin — same org, different country, still visible", () => {
  const vietnamese = souser({ country: "VN" });
  assert.equal(canViewAnnouncement(vietnamese, souserPost({ country: ["PH"] })), true,
    "the organisation decides the audience; country is not part of the identity");
});

test("REGRESSION: an untargeted general bulletin reaches a SOUSER", () => {
  // The old rule required a bulletin to name the SOUSER's country AND sending
  // org explicitly, so every general post was invisible to every SOUSER.
  assert.equal(canViewAnnouncement(souser(), generalPost({ country: null, sending_org: null })), true);
  assert.equal(canViewAnnouncement(souser(), generalPost({ country: [], sending_org: null })), true);
});

test("a country-targeted general bulletin follows the same rule for SOUSER and USER", () => {
  const post = generalPost({ country: ["PH"] });
  assert.equal(canViewAnnouncement(souser({ country: "PH" }), post), true);
  assert.equal(canViewAnnouncement(souser({ country: "VN" }), post), false);
  assert.equal(canViewAnnouncement(employee({ country: "PH" }), post), true);
  assert.equal(canViewAnnouncement(employee({ country: "VN" }), post), false);
});

test("an org-targeted general bulletin reaches that organisation's SOUSER only", () => {
  const post = generalPost({ sending_org: "ALPHA" });
  assert.equal(canViewAnnouncement(souser(), post), true);
  assert.equal(canViewAnnouncement(souser({ sendingOrg: "BETA" }), post), false);
});

test("a company-targeted bulletin does not reach a SOUSER, who belongs to no company", () => {
  const post = generalPost({ company: ["company-1"] });
  assert.equal(canViewAnnouncement(souser(), post), false);
  assert.equal(canViewAnnouncement(employee({ company: "company-1" }), post), true);
  assert.equal(canViewAnnouncement(employee({ company: "company-2" }), post), false);
});

// ── Direct-request bypass attempts ───────────────────────────────────────────

test("BYPASS: naming another organisation's row_id directly does not make it visible", () => {
  const beta = souser({ id: "so-beta-1", sendingOrg: "BETA" });
  const alphaPost = souserPost({ row_id: 4242 });
  assert.equal(canViewAnnouncement(beta, alphaPost), false);
});

test("BYPASS: a bulletin whose sending_org was set to the caller's org but authored elsewhere stays hidden", () => {
  // created_by_sending_org is what the check keys on; a.sending_org is only a
  // targeting field and cannot be used to smuggle authorship.
  const beta = souser({ id: "so-beta-1", sendingOrg: "BETA" });
  assert.equal(canViewAnnouncement(beta, souserPost({ sending_org: "BETA", created_by_sending_org: "ALPHA" })), false);
});

test("BYPASS: an empty created_by_sending_org is read as officer-authored, not as a wildcard match", () => {
  const noOrg = souser({ sendingOrg: "" });

  // An empty author org falls to the general rules, so an untargeted post is
  // readable — it is not an organisation-restricted post that matched on "".
  assert.equal(canViewAnnouncement(noOrg, generalPost({ created_by_sending_org: "" })), true);

  // And it never satisfies a real organisation restriction.
  assert.equal(canViewAnnouncement(noOrg, souserPost({ created_by_sending_org: "ALPHA" })), false);
  assert.equal(canViewAnnouncement(souser(), souserPost({ created_by_sending_org: "" , sending_org: "ALPHA" })), true,
    "a genuine ALPHA reader still passes the general sending_org targeting");
});

// ── Ownership ────────────────────────────────────────────────────────────────

test("ownership is the author id, compared as a string", () => {
  assert.equal(ownsAnnouncement({ id: "so-alpha-1" }, souserPost()), true);
  assert.equal(ownsAnnouncement({ id: "so-alpha-2" }, souserPost()), false);
  assert.equal(ownsAnnouncement({ id: 7 }, { created_by: "7" }), true);
});

test("a colleague in the same organisation does not own the bulletin", () => {
  const colleague = souser({ id: "so-alpha-2" });
  assert.equal(canViewAnnouncement(colleague, souserPost()), true, "they can read it");
  assert.equal(ownsAnnouncement(colleague, souserPost()), false, "but they cannot edit or delete it");
});

test("ownership needs both ids present", () => {
  assert.equal(ownsAnnouncement({ id: null }, souserPost()), false);
  assert.equal(ownsAnnouncement({ id: "so-alpha-1" }, { created_by: null }), false);
  assert.equal(ownsAnnouncement(null, souserPost()), false);
});

// ── Feed window ──────────────────────────────────────────────────────────────

test("the feed window covers active and in-date, and is separate from visibility", () => {
  const day = new Date("2026-09-06T00:00:00Z");
  assert.equal(isWithinFeedWindow({ active: true }, day), true);
  assert.equal(isWithinFeedWindow({ active: false }, day), false);
  assert.equal(isWithinFeedWindow({ active: true, date_from: "2026-09-07" }, day), false);
  assert.equal(isWithinFeedWindow({ active: true, date_to: "2026-09-05" }, day), false);
  assert.equal(isWithinFeedWindow({ active: true, date_from: "2026-09-06", date_to: "2026-09-06" }, day), true);
});

// ── SQL mirrors ──────────────────────────────────────────────────────────────
// The list query runs in SQL and cannot be exercised without a database, so
// these assert the predicate is built from the same branches as the JS rule.

test("the SOUSER SQL branch keys on the author org and never consults country there", () => {
  const sql = souserFeedPredicate({ orgParam: "$3", countryParam: "$4" });
  const authored = sql.split("ELSE")[0];

  assert.match(authored, /a\.created_by_sending_org IS NOT NULL/);
  assert.match(authored, /a\.created_by_sending_org = \$3/);
  assert.doesNotMatch(authored, /country/,
    "country in the SOUSER-authored branch would restrict on its own");
  assert.doesNotMatch(authored, /company/);
});

test("the SOUSER SQL general branch applies the USER-like targeting rules", () => {
  const general = souserFeedPredicate({ orgParam: "$3", countryParam: "$4" }).split("ELSE")[1];

  assert.match(general, /a\.sending_org IS NULL OR a\.sending_org = \$3/);
  assert.match(general, /a\.country IS NULL OR cardinality\(a\.country\) = 0 OR \$4::text = ANY\(a\.country\)/);
  assert.match(general, /a\.company IS NULL OR cardinality\(a\.company\) = 0/);
});

test("the USER SQL branch restricts SOUSER-authored posts to the matching organisation", () => {
  const sql = userFeedPredicate({ companyClause: "(true)" });
  const authored = sql.split("ELSE")[0];

  assert.match(authored, /requester\.sending_org IS NOT NULL/,
    "a NULL sending_org must not match a NULL comparison and leak the post");
  assert.match(authored, /requester\.sending_org = a\.created_by_sending_org/);
});

test("both SQL branches use placeholders only — no value is ever interpolated", () => {
  const souserSql = souserFeedPredicate({ orgParam: "$3", countryParam: "$4" });
  const userSql   = userFeedPredicate({ companyClause: "(a.company IS NULL)" });
  for (const sql of [souserSql, userSql]) {
    assert.doesNotMatch(sql, /'/, "a quote in the predicate would mean an inlined literal");
  }
});
