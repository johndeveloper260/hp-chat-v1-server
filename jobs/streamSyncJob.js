/**
 * Stream Sync Job
 *
 * Syncs DB profile data → GetStream user attributes for all active users.
 * Scheduled daily at 05:00 JST (20:00 UTC).
 *
 * Attributes synced:
 *   name            ← formatDisplayName(last, first, middle)
 *   company         ← user_profile_tbl.company (UUID)
 *   company_name    ← company_tbl.company_name (ja, fallback en)
 *   batch_no        ← user_profile_tbl.batch_no
 *   sending_org     ← user_profile_tbl.sending_org
 *   visa_type       ← user_visa_info_tbl.visa_type
 *   visa_type_descr ← visa_list_tbl.descr (ja, fallback en)
 *   business_unit   ← user_account_tbl.business_unit
 *   user_type       ← user_profile_tbl.user_type
 *   email           ← user_account_tbl.email (lowercased + trimmed)
 *   image           ← shared_attachments (latest profile pic via CloudFront or proxy)
 */

import cron from "node-cron";
import { StreamChat } from "stream-chat";
import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 100; // Stream recommended max per upsertUsers call
const CRON_SCHEDULE = "0 20 * * *"; // 20:00 UTC = 05:00 JST

// ── Lazy singleton ────────────────────────────────────────────────────────────

let _streamChat;
const getStreamChat = () => {
  if (!_streamChat) {
    _streamChat = StreamChat.getInstance(env.stream.apiKey, env.stream.apiSecret);
  }
  return _streamChat;
};

// ── Core sync logic ───────────────────────────────────────────────────────────

/**
 * Fetches all active users with profile, visa, and company data in one query,
 * then upserts them to GetStream in batches.
 *
 * @returns {{ synced: number, skipped: number, errors: number }}
 */
export async function runStreamSync() {
  console.log("[StreamSync] Starting sync...");
  const startedAt = Date.now();

  // Single JOIN — covers all 4 required tables
  const { rows } = await getPool().query(`
    SELECT
      a.id                                                          AS user_id,
      a.email,
      a.business_unit,
      p.first_name,
      p.last_name,
      p.middle_name,
      p.user_type,
      p.country,
      p.company,
      COALESCE(
        NULLIF(c.company_name->>'ja', ''),
        NULLIF(c.company_name->>'en', '')
      )                                                             AS company_name,
      p.batch_no,
      p.sending_org,
      v.visa_type,
      COALESCE(
        NULLIF(vl.descr->>'ja', ''),
        NULLIF(vl.descr->>'en', '')
      )                                                             AS visa_type_descr,
      sa.s3_key                                                     AS profile_pic_s3_key
    FROM v4.user_account_tbl a
    JOIN  v4.user_profile_tbl     p  ON p.user_id = a.id
    LEFT JOIN v4.company_tbl      c  ON p.company::uuid = c.company_id
    LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = a.id
    LEFT JOIN v4.visa_list_tbl    vl ON vl.code = v.visa_type
                                    AND vl.business_unit = a.business_unit
    LEFT JOIN LATERAL (
      SELECT s3_key
      FROM v4.shared_attachments
      WHERE relation_type = 'profile'
        AND relation_id = a.id::text
      ORDER BY created_at DESC
      LIMIT 1
    ) sa ON true
    WHERE a.is_active = true
  `);

  console.log(`[StreamSync] ${rows.length} active users fetched from DB.`);

  const streamChat = getStreamChat();
  let synced = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of BATCH_SIZE
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const streamUsers = batch
      .map((u) => {
        if (!u.user_id) { skipped++; return null; }

        const name = formatDisplayName(u.last_name, u.first_name, u.middle_name);
        const payload = { id: String(u.user_id) };

        // Only include fields that have a non-null value to avoid
        // overwriting existing Stream attributes with empty data
        if (name)              payload.name            = name;
        if (u.email)           payload.email           = u.email.toLowerCase().trim();
        if (u.company)         payload.company         = u.company;
        if (u.company_name)    payload.company_name    = u.company_name;
        if (u.batch_no)        payload.batch_no        = u.batch_no;
        if (u.sending_org)     payload.sending_org     = u.sending_org;
        if (u.visa_type)       payload.visa_type       = u.visa_type;
        if (u.visa_type_descr) payload.visa_type_descr = u.visa_type_descr;
        if (u.business_unit)   payload.business_unit   = u.business_unit;
        if (u.user_type)       payload.user_type       = u.user_type;
        if (u.country)         payload.country         = u.country;

        if (u.profile_pic_s3_key) {
          payload.image = env.aws.cloudfrontDomain
            ? `https://${env.aws.cloudfrontDomain}/${u.profile_pic_s3_key}`
            : `${env.app.backendUrl}/profile/avatar/${u.user_id}`;
        }

        return payload;
      })
      .filter(Boolean);

    if (!streamUsers.length) continue;

    try {
      await streamChat.upsertUsers(streamUsers);
      synced += streamUsers.length;
      console.log(
        `[StreamSync] Batch ${Math.floor(i / BATCH_SIZE) + 1}: upserted ${streamUsers.length} users.`,
      );
    } catch (err) {
      errors += streamUsers.length;
      console.error(
        `[StreamSync] Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`,
        err.message,
      );
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[StreamSync] Done in ${elapsed}s — synced: ${synced}, skipped: ${skipped}, errors: ${errors}`,
  );

  return { synced, skipped, errors };
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

/**
 * Registers the cron job. Call once from server.js after DB connects.
 */
export function scheduleStreamSync() {
  cron.schedule(
    CRON_SCHEDULE,
    async () => {
      try {
        await runStreamSync();
      } catch (err) {
        console.error("[StreamSync] Unexpected error during scheduled run:", err);
      }
    },
    { timezone: "UTC" },
  );

  console.log("[StreamSync] Scheduled — daily at 05:00 JST (20:00 UTC).");
}
