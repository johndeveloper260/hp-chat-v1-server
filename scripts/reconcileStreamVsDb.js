/**
 * Stream ↔ Postgres reconciliation report.
 *
 * READ-ONLY. This script never writes to Stream and never writes to Postgres.
 * It only calls streamClient.queryUsers() and SELECTs. There is deliberately no
 * upsertUser / upsertUsers / partialUpdateUser / deleteUser call in this file.
 *
 * Postgres is the source of truth. For every user in scope the script builds the
 * value each Stream attribute *should* have, compares it to what Stream actually
 * holds, and reports the difference.
 *
 * Scope:
 *   - Real app users only. Sousers are excluded (no v4.user_profile_tbl row —
 *     their Stream metadata is owned by souserService, not by the sync paths).
 *   - Anonymized accounts (email 'deleted_%') are excluded — their Stream user is
 *     soft-deleted on purpose.
 *   - Inactive users ARE included by default: the nightly job skips them, so they
 *     are the most likely to have drifted. Use --active-only to exclude them.
 *
 * business_unit:
 *   Compared and reported, but NEVER included in a fix payload. It is not mutated
 *   anywhere in this codebase after account creation, so a mismatch means something
 *   changed it out-of-band and needs a human. See BUSINESS_UNIT_IS_READ_ONLY below.
 *
 * Usage:
 *   node --env-file=.env scripts/reconcileStreamVsDb.js
 *   node --env-file=.env scripts/reconcileStreamVsDb.js --active-only
 *   node --env-file=.env scripts/reconcileStreamVsDb.js --limit=200 --out=output/diff.json
 *   node --env-file=.env scripts/reconcileStreamVsDb.js --orphans
 */

import fs from "node:fs";
import path from "node:path";
import { StreamChat } from "stream-chat";

import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import { toCsv } from "../utils/csv.js";
import {
  PROJECTION_SELECT,
  PROJECTION_FROM,
  projectAttributes,
  buildUpdatePayload,
} from "../utils/streamUserProjection.js";

// ── Guard rails ───────────────────────────────────────────────────────────────

/**
 * business_unit is report-only. It is never emitted into a fix payload, and any
 * future apply step built on this report must keep it that way.
 */
const BUSINESS_UNIT_IS_READ_ONLY = true;

/** Stream caps queryUsers at 100 records per call. */
const STREAM_QUERY_LIMIT = 100;

/** Stream caps offset-based pagination of queryUsers at 1000. */
const STREAM_MAX_OFFSET = 1000;

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const ACTIVE_ONLY = flag("active-only");
const SCAN_ORPHANS = flag("orphans");
const LIMIT = opt("limit") ? Number(opt("limit")) : null;
const SAMPLE = Number(opt("sample", "25"));
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_JSON = opt("out", `output/stream-db-diff-${STAMP}.json`);
const OUT_CSV = OUT_JSON.replace(/\.json$/, "") + ".csv";

// ── Canonical expected values ─────────────────────────────────────────────────

/**
 * The comparison baseline is the shared projection in utils/streamUserProjection.js —
 * the same SELECT list, joins and value resolution the writers use. Only the WHERE is
 * this script's own, because the audit deliberately covers a wider scope than the
 * nightly job: inactive users are included by default (the job skips them, so they are
 * the most likely to have drifted) and anonymized accounts are excluded.
 *
 * Sousers are excluded here explicitly as well as by the projection's inner join on
 * user_profile_tbl, so the skip is visible in the report rather than implied.
 */
const EXPECTED_QUERY = `
  SELECT ${PROJECTION_SELECT}
  ${PROJECTION_FROM}
  LEFT JOIN v4.souser_tbl su ON su.id = a.id
  WHERE su.id IS NULL                       -- exclude sousers
    AND a.email NOT LIKE 'deleted\\_%'      -- exclude anonymized accounts
    ${ACTIVE_ONLY ? "AND a.is_active = true" : ""}
  ORDER BY a.id
  ${LIMIT ? `LIMIT ${Number(LIMIT)}` : ""}
`;

/** Counts what the scope filters excluded, so the report can state its own blind spots. */
const SKIPPED_QUERY = `
  SELECT
    COUNT(*) FILTER (WHERE su.id IS NOT NULL)                              AS sousers,
    COUNT(*) FILTER (WHERE su.id IS NULL AND a.email LIKE 'deleted\\_%')   AS anonymized,
    COUNT(*) FILTER (WHERE su.id IS NULL AND p.user_id IS NULL
                       AND a.email NOT LIKE 'deleted\\_%')                 AS no_profile_row
  FROM v4.user_account_tbl a
  LEFT JOIN v4.user_profile_tbl p ON p.user_id = a.id
  LEFT JOIN v4.souser_tbl       su ON su.id = a.id
`;

/**
 * Fields the writers own come from projectAttributes() — the same function that
 * builds what actually gets written, so the audit cannot drift from the fix.
 *
 * business_unit is NOT in that set. It is compared separately and reported on its
 * own track, and never appears in a fix payload.
 */
const READ_ONLY_FIELD = "business_unit";

// ── Comparison ────────────────────────────────────────────────────────────────

/** null, undefined and "" all mean "absent". Everything else compares as a string. */
const norm = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

/**
 * Narrows a full partial-update payload to only the fields that drifted.
 * @param {{id: string, set?: object, unset?: string[]}|null} payload
 * @param {Set<string>} fields
 */
const narrowFix = (payload, fields) => {
  if (!payload) return null;

  const set = Object.fromEntries(
    Object.entries(payload.set ?? {}).filter(([k]) => fields.has(k)),
  );
  const unset = (payload.unset ?? []).filter((k) => fields.has(k));

  return {
    id: payload.id,
    ...(Object.keys(set).length ? { set } : {}),
    ...(unset.length ? { unset } : {}),
  };
};

// ── Stream fetch ──────────────────────────────────────────────────────────────

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/**
 * Fetches the Stream user objects for the given ids.
 * Queries by id so the 1000-record offset cap never applies.
 * @returns {Map<string, object>}
 */
const fetchStreamUsers = async (client, ids) => {
  const found = new Map();
  const batches = chunk(ids, STREAM_QUERY_LIMIT);

  for (const [i, batch] of batches.entries()) {
    const { users } = await client.queryUsers(
      { id: { $in: batch } },
      { id: 1 },
      { limit: STREAM_QUERY_LIMIT, presence: false },
    );
    for (const u of users) found.set(String(u.id), u);
    process.stdout.write(`\r  Stream fetch: ${i + 1}/${batches.length} batches`);
  }
  if (batches.length) process.stdout.write("\n");

  return found;
};

/**
 * Best-effort scan for Stream users with no matching row in Postgres.
 * Stream caps offset pagination at 1000, so on a larger workspace this is a
 * partial scan — the report says so rather than implying completeness.
 */
const scanOrphans = async (client, dbIds) => {
  const orphans = [];
  let offset = 0;
  let truncated = false;

  while (offset < STREAM_MAX_OFFSET) {
    const { users } = await client.queryUsers(
      {},
      { created_at: 1 },
      { limit: STREAM_QUERY_LIMIT, offset, presence: false },
    );
    if (!users.length) break;

    for (const u of users) {
      const id = String(u.id);
      if (!dbIds.has(id)) {
        orphans.push({ id, name: u.name ?? null, business_unit: u.business_unit ?? null });
      }
    }

    offset += users.length;
    if (users.length < STREAM_QUERY_LIMIT) break;
    if (offset >= STREAM_MAX_OFFSET) truncated = true;
  }

  return { orphans, truncated };
};

// ── Reporting helpers ─────────────────────────────────────────────────────────

const pad = (label, width = 30) => label.padEnd(width, ".");
const num = (n) => n.toLocaleString("en-US");
const show = (v) => (v === null ? "∅" : `"${v}"`);

// ── Main ──────────────────────────────────────────────────────────────────────

const pool = getPool();
const streamClient = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);

console.log("\nStream ↔ Postgres reconciliation  (READ-ONLY — nothing is written)");
console.log("Postgres is the source of truth.\n");

const { rows: rawRows } = await pool.query(EXPECTED_QUERY);
const { rows: [skipped] } = await pool.query(SKIPPED_QUERY);

// A user with more than one v4.user_visa_info_tbl row would be counted twice by the
// LEFT JOIN. Keep the first and say so — a silently doubled total would misreport drift.
const seen = new Set();
const rows = rawRows.filter((r) => (seen.has(r.user_id) ? false : seen.add(r.user_id)));
if (rows.length !== rawRows.length) {
  console.log(
    `  ! ${rawRows.length - rows.length} duplicate row(s) from multiple visa records — first kept per user.`,
  );
}

console.log(`  ${rows.length} users in scope. Fetching from Stream...`);

const dbIds = new Set(rows.map((r) => r.user_id));
const streamUsers = await fetchStreamUsers(streamClient, [...dbIds]);

const missingInStream = [];
const mismatched = [];
const businessUnitMismatches = [];
const driftByField = {};
const bump = (field) => { driftByField[field] = (driftByField[field] ?? 0) + 1; };
let inSync = 0;
let inactiveInScope = 0;

for (const row of rows) {
  if (!row.is_active) inactiveInScope++;

  const streamUser = streamUsers.get(row.user_id);

  if (!streamUser) {
    missingInStream.push({
      user_id: row.user_id,
      email: row.email,
      is_active: row.is_active,
      business_unit: row.business_unit,
    });
    continue;
  }

  const diffs = [];
  const driftedFields = new Set();

  // Fields the sync paths own, compared against what they would write.
  for (const [field, value] of Object.entries(projectAttributes(row))) {
    const expected = norm(value);
    const actual = norm(streamUser[field]);
    if (expected === actual) continue;

    bump(field);
    driftedFields.add(field);
    diffs.push({ field, postgres: expected, stream: actual, writable: true });
  }

  // business_unit: reported, never fixed.
  const buExpected = norm(row.business_unit);
  const buActual = norm(streamUser[READ_ONLY_FIELD]);
  if (buExpected !== buActual) {
    bump(READ_ONLY_FIELD);
    diffs.push({ field: READ_ONLY_FIELD, postgres: buExpected, stream: buActual, writable: false });
    businessUnitMismatches.push({
      user_id: row.user_id,
      email: row.email,
      postgres: buExpected,
      stream: buActual,
    });
  }

  if (!diffs.length) {
    inSync++;
    continue;
  }

  mismatched.push({
    user_id: row.user_id,
    email: row.email,
    is_active: row.is_active,
    business_unit: row.business_unit,
    diffs,
    // Built by the shared payload builder, then narrowed to the fields that actually
    // drifted — so the fix carries exactly the values a real sync would write, with
    // no blast radius beyond the mismatch. business_unit can never appear here: the
    // builder does not emit it.
    fix: narrowFix(buildUpdatePayload(row), driftedFields),
  });
}

let orphanResult = null;
if (SCAN_ORPHANS) {
  console.log("  Scanning for Stream users absent from Postgres...");
  // Orphan membership must cover all accounts, independently of audit filters.
  const { rows: accounts } = await pool.query("SELECT id::text AS id FROM v4.user_account_tbl");
  const allAccountIds = new Set(accounts.map(({ id }) => id));
  orphanResult = await scanOrphans(streamClient, allAccountIds);
}

// ── Console summary ───────────────────────────────────────────────────────────

console.log("\nScope");
console.log(`  ${pad("Users compared")} ${num(rows.length)}`);
console.log(`  ${pad("  of which inactive")} ${num(inactiveInScope)}${ACTIVE_ONLY ? " (--active-only)" : ""}`);
console.log(`  ${pad("Skipped: sousers")} ${num(Number(skipped.sousers))}`);
console.log(`  ${pad("Skipped: anonymized")} ${num(Number(skipped.anonymized))}`);
console.log(`  ${pad("Skipped: no profile row")} ${num(Number(skipped.no_profile_row))}`);

console.log("\nResults");
console.log(`  ${pad("In sync")} ${num(inSync)}`);
console.log(`  ${pad("Field mismatches")} ${num(mismatched.length)}`);
console.log(`  ${pad("Missing in Stream")} ${num(missingInStream.length)}`);
console.log(
  `  ${pad("business_unit mismatches")} ${num(businessUnitMismatches.length)}   <- REPORT ONLY, never written`,
);
if (orphanResult) {
  console.log(
    `  ${pad("In Stream, not in Postgres")} ${num(orphanResult.orphans.length)}` +
      (orphanResult.truncated ? `   (partial — Stream caps this scan at ${STREAM_MAX_OFFSET})` : ""),
  );
}

console.log("\nDrift by field (Postgres value wins)");
const ranked = Object.entries(driftByField)
  .filter(([, n]) => n > 0)
  .sort((a, b) => b[1] - a[1]);

if (!ranked.length) {
  console.log("  none");
} else {
  for (const [field, count] of ranked) {
    const ro = field === "business_unit" ? "  <- read-only" : "";
    console.log(`  ${pad(field, 24)} ${num(count)}${ro}`);
  }
}

if (mismatched.length) {
  console.log(`\nSample (first ${Math.min(SAMPLE, mismatched.length)} of ${num(mismatched.length)})`);
  for (const m of mismatched.slice(0, SAMPLE)) {
    console.log(`\n  ${m.user_id}  ${m.email}${m.is_active ? "" : "  [inactive]"}`);
    for (const d of m.diffs) {
      const tag = d.writable ? "" : "  (read-only)";
      console.log(`    ${d.field.padEnd(18)} pg=${show(d.postgres)}  stream=${show(d.stream)}${tag}`);
    }
  }
}

if (businessUnitMismatches.length) {
  console.log(
    `\n!! ${businessUnitMismatches.length} user(s) have a business_unit in Stream that disagrees with Postgres.`,
  );
  console.log(
    "   Nothing in this repo updates business_unit after account creation, so this needs a human.",
  );
  console.log("   It is excluded from every fix payload in the JSON report.");
}

// ── Write report ──────────────────────────────────────────────────────────────

const report = {
  generated_at: new Date().toISOString(),
  read_only: true,
  source_of_truth: "postgres",
  never_written: BUSINESS_UNIT_IS_READ_ONLY ? ["business_unit"] : [],
  scope: {
    users_compared: rows.length,
    inactive_included: !ACTIVE_ONLY,
    inactive_in_scope: inactiveInScope,
    limit: LIMIT,
    skipped: {
      sousers: Number(skipped.sousers),
      anonymized: Number(skipped.anonymized),
      no_profile_row: Number(skipped.no_profile_row),
    },
  },
  totals: {
    in_sync: inSync,
    field_mismatches: mismatched.length,
    missing_in_stream: missingInStream.length,
    business_unit_mismatches: businessUnitMismatches.length,
    drift_by_field: driftByField,
  },
  missing_in_stream: missingInStream,
  business_unit_mismatches: businessUnitMismatches,
  mismatched,
  orphans_in_stream: orphanResult,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));

const csvRows = [
  ["user_id", "email", "is_active", "business_unit", "field", "postgres_value", "stream_value", "writable"],
  ...mismatched.flatMap((m) =>
    m.diffs.map((d) => [
      m.user_id,
      m.email,
      String(m.is_active),
      m.business_unit,
      d.field,
      d.postgres ?? "",
      d.stream ?? "",
      String(d.writable),
    ]),
  ),
  ...missingInStream.map((u) => [
    u.user_id,
    u.email,
    String(u.is_active),
    u.business_unit,
    "(entire user)",
    "present",
    "MISSING",
    "true",
  ]),
];
fs.writeFileSync(OUT_CSV, toCsv(csvRows));

console.log(`\nWrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
console.log("\nNo data was modified. Each mismatched user carries a `fix` partial-update");
console.log("payload in the JSON, ready for a separate apply step.\n");

await pool.end();
