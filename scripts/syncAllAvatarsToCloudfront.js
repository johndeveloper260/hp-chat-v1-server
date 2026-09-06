/**
 * One-time script: re-sync all users' Stream Chat attributes from Postgres,
 * including the CloudFront image URL.
 *
 * Delegates to the same projection and the same writer as the nightly job
 * (utils/streamUserProjection.js, pushUpdates), so it cannot disagree with
 * runStreamSync() or rewrite business_unit. At this point it is equivalent to
 * POST /stream/sync/run and is kept only for the CloudFront precondition below.
 *
 * Usage:
 *   node --env-file=.env scripts/syncAllAvatarsToCloudfront.js
 */

import env from "../config/env.js";
import { getPool } from "../config/getPool.js";
import { PROJECT_ALL_SQL } from "../utils/streamUserProjection.js";
import { pushUpdates } from "../utils/syncUserToStream.js";

if (!env.aws.cloudfrontDomain) {
  console.error("CLOUDFRONT_DOMAIN is not set. Aborting.");
  process.exit(1);
}

const pool = getPool();
const { rows } = await pool.query(PROJECT_ALL_SQL);

console.log(`Found ${rows.length} users. Syncing...`);

const { synced, skipped, errors } = await pushUpdates(rows, "[AvatarSync]");

console.log(`Done — synced: ${synced}, skipped: ${skipped}, errors: ${errors}`);
await pool.end();
