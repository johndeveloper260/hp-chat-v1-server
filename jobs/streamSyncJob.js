/**
 * Stream Sync Job
 *
 * Reconciles GetStream user attributes from Postgres for all users.
 * Scheduled daily at 05:00 JST (20:00 UTC).
 *
 * What gets synced is defined once, in utils/streamUserProjection.js, and written
 * once, by pushUpdates() in utils/syncUserToStream.js — this file holds no SQL,
 * builds no payloads, and talks to no SDK. Two consequences worth knowing:
 *
 *   - business_unit is NOT synced here. It is written once at registration and is
 *     never rewritten by any reconciliation path.
 *   - Writes are partial (set/unset), so attributes this projection does not own
 *     survive the run instead of being replaced away.
 *
 * Registration is scheduled from server.js and gated on RUN_CRON, so exactly one
 * dyno runs it.
 */

import cron from "node-cron";

import { getPool } from "../config/getPool.js";
import { PROJECT_ALL_SQL } from "../utils/streamUserProjection.js";
import { pushUpdates } from "../utils/syncUserToStream.js";

const CRON_SCHEDULE = "0 20 * * *"; // 20:00 UTC = 05:00 JST

/**
 * Projects every user from Postgres and partial-updates them in Stream.
 *
 * @returns {{ synced: number, skipped: number, errors: number }}
 */
export async function runStreamSync() {
  console.log("[StreamSync] Starting sync...");
  const startedAt = Date.now();

  const { rows } = await getPool().query(PROJECT_ALL_SQL);
  console.log(`[StreamSync] ${rows.length} users fetched from DB.`);

  const result = await pushUpdates(rows, "[StreamSync]");

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[StreamSync] Done in ${elapsed}s — synced: ${result.synced}, ` +
      `skipped: ${result.skipped}, errors: ${result.errors}`,
  );

  return result;
}

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
