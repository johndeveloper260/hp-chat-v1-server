import test from "node:test";
import assert from "node:assert/strict";

// config/env.js validates at import time and throws on a missing variable, so the
// projection module is imported dynamically once the environment is stubbed.
// These values are never used to connect to anything — the payload builders are pure.
process.env.DB_HOST ??= "test";
process.env.DB_USER ??= "test";
process.env.DB_PASS ??= "test";
process.env.DB_DATABASE ??= "test";
process.env.SECRET_TOKEN ??= "test";
process.env.STREAM_API_KEY ??= "test";
process.env.STREAM_API_SECRET ??= "test";
process.env.CLOUDFRONT_DOMAIN ??= "cdn.example.net";

const {
  buildUpdatePayload,
  buildCreatePayload,
  PROJECT_ONE_SQL,
  PROJECT_ALL_SQL,
  PROJECT_BY_COMPANY_SQL,
  PROJECT_BY_VISA_TYPE_SQL,
} = await import("../utils/streamUserProjection.js");

const ALL_PROJECTIONS = {
  PROJECT_ONE_SQL,
  PROJECT_ALL_SQL,
  PROJECT_BY_COMPANY_SQL,
  PROJECT_BY_VISA_TYPE_SQL,
};

/** A fully populated projection row, matching PROJECT_ONE_SQL's columns. */
const row = (overrides = {}) => ({
  user_id: "ac69694d-4d1e-41a2-9170-a5abe928eaf6",
  email: "  Worker@Example.COM ",
  business_unit: "FWARD",
  is_active: true,
  first_name: "Taro",
  middle_name: null,
  last_name: "Yamada",
  user_type: "USER",
  country: "PH",
  company: "ac69694d-4d1e-41a2-9170-a5abe928eaf6",
  batch_no: 2,
  sending_org: "GMC",
  visa_type: "V01",
  company_name: "株式会社一条工務店　【大工】",
  visa_type_descr: "技能実習生１号",
  profile_pic_s3_key: "profile/abc.jpg",
  ...overrides,
});

test("update payload never carries business_unit", () => {
  const payload = buildUpdatePayload(row());

  assert.equal("business_unit" in payload.set, false);
  assert.equal(payload.unset?.includes("business_unit") ?? false, false);
});

test("update payload still omits business_unit when the DB value is null", () => {
  const payload = buildUpdatePayload(row({ business_unit: null }));

  assert.equal("business_unit" in payload.set, false);
  assert.equal(payload.unset?.includes("business_unit") ?? false, false);
});

test("update payload sets the fields Postgres owns", () => {
  const { set } = buildUpdatePayload(row());

  assert.equal(set.name, "Yamada, Taro");
  assert.equal(set.email, "worker@example.com");
  assert.equal(set.user_type, "USER");
  assert.equal(set.company_name, "株式会社一条工務店　【大工】");
  assert.equal(set.visa_type, "V01");
  assert.equal(set.visa_type_descr, "技能実習生１号");
  assert.equal(set.sending_org, "GMC");
  assert.equal(set.country, "PH");
  assert.equal(set.batch_no, 2);
  assert.equal(set.image, "https://cdn.example.net/profile/abc.jpg");
});

test("fields cleared in Postgres are unset, not left stale", () => {
  const payload = buildUpdatePayload(
    row({ sending_org: null, country: "", visa_type: null, profile_pic_s3_key: null }),
  );

  assert.deepEqual(
    payload.unset.sort(),
    ["country", "image", "sending_org", "visa_type"].sort(),
  );
  assert.equal("sending_org" in payload.set, false);
  assert.equal("country" in payload.set, false);
});

test("batch_no of 0 is a value, not an absent field", () => {
  const { set, unset } = buildUpdatePayload(row({ batch_no: 0 }));

  assert.equal(set.batch_no, 0);
  assert.equal(unset?.includes("batch_no") ?? false, false);
});

test("update payload is null when there is no user to write", () => {
  assert.equal(buildUpdatePayload({ user_id: null }), null);
  assert.equal(buildUpdatePayload(null), null);
});

test("create payload carries business_unit — the only path that may", () => {
  const user = buildCreatePayload(row());

  assert.equal(user.business_unit, "FWARD");
  assert.equal(user.id, "ac69694d-4d1e-41a2-9170-a5abe928eaf6");
  assert.equal(user.name, "Yamada, Taro");
});

test("create payload omits absent fields rather than writing nulls", () => {
  const user = buildCreatePayload(row({ sending_org: null, profile_pic_s3_key: null }));

  assert.equal("sending_org" in user, false);
  assert.equal("image" in user, false);
});

// ── SQL invariants ────────────────────────────────────────────────────────────
// These guard the two bugs that made the nightly job unable to finish or unable to
// reach a user at all. They are string assertions because there is no DB fixture
// harness in this repo — cheap, but they fail loudly if someone reintroduces either.

test("no projection casts p.company to uuid", () => {
  // p.company is unvalidated text; ::uuid raises 22P02 on a malformed value and
  // aborts the whole query, which for the nightly job means zero users sync.
  for (const [name, sql] of Object.entries(ALL_PROJECTIONS)) {
    assert.equal(
      /p\.company\s*::\s*uuid/i.test(sql),
      false,
      `${name} casts p.company to uuid — join on c.company_id::text instead`,
    );
  }
});

test("every projection excludes anonymized accounts", () => {
  // Their Stream user is deleted on purpose by loginService; a partial update
  // would either fail or resurrect a record meant to be gone.
  for (const [name, sql] of Object.entries(ALL_PROJECTIONS)) {
    assert.ok(
      sql.includes("a.email NOT LIKE 'deleted\\_%'"),
      `${name} does not exclude anonymized accounts`,
    );
  }
});

test("full reconciliation is not limited to active users", () => {
  // Deactivating a user does not deactivate them in Stream. Filtering on is_active
  // would freeze their Stream record with no path back to correctness.
  assert.equal(
    /is_active\s*=\s*true/i.test(PROJECT_ALL_SQL),
    false,
    "PROJECT_ALL_SQL filters on is_active — inactive users would never reconcile",
  );
});

test("fan-out projections are parameterized and business-unit scoped", () => {
  for (const [name, sql] of [
    ["PROJECT_BY_COMPANY_SQL", PROJECT_BY_COMPANY_SQL],
    ["PROJECT_BY_VISA_TYPE_SQL", PROJECT_BY_VISA_TYPE_SQL],
  ]) {
    assert.ok(sql.includes("$1") && sql.includes("$2"), `${name} is not parameterized`);
    assert.ok(
      sql.includes("a.business_unit = $2"),
      `${name} is not scoped to a business unit`,
    );
  }
});
