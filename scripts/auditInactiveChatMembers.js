/**
 * Inactive-account chat audit.
 *
 * READ-ONLY. This script never writes to Stream and never writes to Postgres.
 * It only calls streamClient.queryUsers(), streamClient.queryChannels() and
 * SELECTs. There is deliberately no deactivateUser / revokeUserToken /
 * removeMembers / upsertUser call in this file.
 *
 * Postgres is the source of truth for is_active. Accounts deactivated before
 * 2026-09-06 never had revokeStreamAccess() run, so Stream can still treat them
 * as live users and they still sit in group channels. Two reports:
 *
 *   1. Stream users NOT deactivated although is_active = false in Postgres
 *      (and no revoke_tokens_issued_before stamp, so old tokens still work).
 *   2. Stream channels that still contain one or more of those inactive accounts.
 *
 * Anonymized accounts (email 'deleted_%') are excluded — their Stream user is
 * soft-deleted on purpose.
 *
 * Usage:
 *   node --env-file=.env scripts/auditInactiveChatMembers.js
 *   node --env-file=.env scripts/auditInactiveChatMembers.js --out=output/inactive-chat.json
 *   node --env-file=.env scripts/auditInactiveChatMembers.js --no-channels
 */

import fs from "node:fs";
import path from "node:path";
import { StreamChat } from "stream-chat";

import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import { toCsv } from "../utils/csv.js";

/** Stream caps queryUsers at 100 records per call. */
const STREAM_QUERY_LIMIT = 100;

/** queryChannels page size; channels are paged by created_at, not offset. */
const CHANNEL_PAGE = 30;

/** Ids per $in filter when looking up channels by member. */
const CHANNEL_MEMBER_BATCH = 50;

// ── CLI ───────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, fallback = null) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const SKIP_CHANNELS = flag("no-channels");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const OUT_JSON = opt("out", `output/inactive-chat-audit-${STAMP}.json`);
const OUT_CSV = OUT_JSON.replace(/\.json$/, "") + ".csv";

const INACTIVE_QUERY = `
  SELECT a.id::text AS user_id, a.email, a.business_unit,
         COALESCE(p.user_type, CASE WHEN su.id IS NOT NULL THEN 'souser' END) AS user_type
  FROM v4.user_account_tbl a
  LEFT JOIN v4.user_profile_tbl p ON p.user_id = a.id
  LEFT JOIN v4.souser_tbl       su ON su.id = a.id
  WHERE a.is_active = false
    AND a.email NOT LIKE 'deleted\\_%'
  ORDER BY a.id
`;

// ── Stream fetch ──────────────────────────────────────────────────────────────

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

/** Queries by id, including deactivated users, so the offset cap never applies. */
const fetchStreamUsers = async (client, ids) => {
  const found = new Map();
  const batches = chunk(ids, STREAM_QUERY_LIMIT);
  for (const [i, batch] of batches.entries()) {
    const { users } = await client.queryUsers(
      { id: { $in: batch } },
      { id: 1 },
      { limit: STREAM_QUERY_LIMIT, presence: false, include_deactivated_users: true },
    );
    for (const u of users) found.set(String(u.id), u);
    process.stdout.write(`\r  Stream users: ${i + 1}/${batches.length} batches`);
  }
  if (batches.length) process.stdout.write("\n");
  return found;
};

/** Every channel with at least one of `ids` as a member, keyed by cid. */
const fetchChannelsWithMembers = async (client, ids) => {
  const inactive = new Set(ids);
  const channels = new Map();
  const batches = chunk(ids, CHANNEL_MEMBER_BATCH);
  for (const [i, batch] of batches.entries()) {
    let createdAt;
    let boundary = [];
    for (;;) {
      const page = await client.queryChannels(
        { members: { $in: batch },
          ...(createdAt ? { created_at: { $gte: createdAt }, cid: { $nin: boundary } } : {}) },
        { created_at: 1 },
        { limit: CHANNEL_PAGE, state: true, watch: false, presence: false, member_limit: 100 },
      );
      for (const ch of page) {
        if (channels.has(ch.cid)) continue;
        const memberIds = Object.keys(ch.state?.members ?? {});
        channels.set(ch.cid, {
          cid: ch.cid,
          name: ch.data?.name ?? null,
          created_by: ch.data?.created_by?.id ?? null,
          member_count: ch.data?.member_count ?? memberIds.length,
          // state.members may be truncated on large channels; the batch hit is the
          // reliable signal, the list is best-effort detail.
          inactive_members: memberIds.filter((id) => inactive.has(id)),
        });
      }
      if (page.length < CHANNEL_PAGE) break;
      const last = String(page.at(-1).data?.created_at ?? "");
      if (!last) throw new Error("Channel pagination requires created_at");
      const tied = page.filter((ch) => String(ch.data?.created_at) === last).map((ch) => ch.cid);
      boundary = last === createdAt ? [...boundary, ...tied] : tied;
      createdAt = last;
    }
    process.stdout.write(`\r  Stream channels: ${i + 1}/${batches.length} batches`);
  }
  if (batches.length) process.stdout.write("\n");
  return [...channels.values()];
};

// ── Main ──────────────────────────────────────────────────────────────────────

const pad = (label, width = 34) => label.padEnd(width, ".");

const pool = getPool();
const streamClient = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);

console.log("\nInactive-account chat audit  (READ-ONLY — nothing is written)");
console.log("Postgres is the source of truth for is_active.\n");

const { rows: inactive } = await pool.query(INACTIVE_QUERY);
console.log(`  ${inactive.length} inactive accounts in Postgres. Fetching from Stream...`);

const streamUsers = await fetchStreamUsers(streamClient, inactive.map((r) => r.user_id));

const notDeactivated = [];
let missingInStream = 0;
for (const row of inactive) {
  const su = streamUsers.get(row.user_id);
  if (!su) { missingInStream++; continue; }
  if (su.deactivated_at) continue;
  notDeactivated.push({
    ...row,
    stream_role: su.role ?? null,
    tokens_revoked_before: su.revoke_tokens_issued_before ?? null,
    last_active: su.last_active ?? null,
  });
}

let channels = null;
if (!SKIP_CHANNELS) {
  const presentIds = inactive.map((r) => r.user_id).filter((id) => streamUsers.has(id));
  channels = await fetchChannelsWithMembers(streamClient, presentIds);
  channels.sort((a, b) => b.inactive_members.length - a.inactive_members.length);
}

console.log("\nResults");
console.log(`  ${pad("Inactive in Postgres")} ${inactive.length}`);
console.log(`  ${pad("  absent from Stream")} ${missingInStream}`);
console.log(`  ${pad("  NOT deactivated in Stream")} ${notDeactivated.length}`);
console.log(`  ${pad("    of which tokens not revoked")} ${notDeactivated.filter((u) => !u.tokens_revoked_before).length}`);
if (channels) console.log(`  ${pad("Channels with inactive members")} ${channels.length}`);

if (channels?.length) {
  console.log("\nChannels (most inactive members first, up to 25)");
  for (const ch of channels.slice(0, 25)) {
    console.log(`  ${ch.cid}  "${ch.name ?? ""}"  members=${ch.member_count}  inactive=${ch.inactive_members.length}  creator=${ch.created_by ?? "?"}`);
  }
}

const report = {
  generated_at: new Date().toISOString(),
  read_only: true,
  source_of_truth: "postgres",
  totals: {
    inactive_in_postgres: inactive.length,
    absent_from_stream: missingInStream,
    not_deactivated_in_stream: notDeactivated.length,
    channels_with_inactive_members: channels?.length ?? null,
  },
  not_deactivated_in_stream: notDeactivated,
  channels_with_inactive_members: channels,
};

fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
fs.writeFileSync(OUT_JSON, JSON.stringify(report, null, 2));
fs.writeFileSync(OUT_CSV, toCsv([
  ["kind", "id", "email_or_name", "business_unit_or_creator", "detail"],
  ...notDeactivated.map((u) => ["user_not_deactivated", u.user_id, u.email, u.business_unit ?? "",
    u.tokens_revoked_before ? "tokens revoked" : "tokens NOT revoked"]),
  ...(channels ?? []).map((ch) => ["channel_with_inactive", ch.cid, ch.name ?? "", ch.created_by ?? "",
    ch.inactive_members.join(" ")]),
]));

console.log(`\nWrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
console.log("\nNo data was modified.\n");

await pool.end();
