/**
 * One-time script: re-sync all users' Stream Chat image field to CloudFront URLs.
 *
 * Usage:
 *   node --env-file=.env scripts/syncAllAvatarsToCloudfront.js
 *
 * Stream's upsertUsers supports up to 100 users per call, so we batch accordingly.
 */

import { StreamChat } from "stream-chat";
import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";
import env from "../config/env.js";

if (!env.aws.cloudfrontDomain) {
  console.error("CLOUDFRONT_DOMAIN is not set. Aborting.");
  process.exit(1);
}

const BATCH_SIZE = 100;

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const ALL_USERS_QUERY = `
  SELECT
    a.id,
    a.email,
    a.business_unit,
    p.first_name,
    p.middle_name,
    p.last_name,
    p.company,
    p.batch_no,
    p.user_type,
    COALESCE(
      c.company_name ->> 'ja',
      c.company_name ->> 'en',
      (SELECT value FROM jsonb_each_text(c.company_name) LIMIT 1)
    ) AS company_name,
    COALESCE(
      vl.descr ->> 'ja',
      vl.descr ->> 'en',
      (SELECT value FROM jsonb_each_text(vl.descr) LIMIT 1)
    ) AS visa_type_descr,
    sa.s3_key AS profile_pic_s3_key
  FROM v4.user_account_tbl a
  LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
  LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
  LEFT JOIN v4.user_visa_info_tbl v ON a.id = v.user_id
  LEFT JOIN v4.visa_list_tbl vl ON (
    v.visa_type = vl.code AND a.business_unit = vl.business_unit
  )
  LEFT JOIN LATERAL (
    SELECT s3_key
    FROM v4.shared_attachments
    WHERE relation_type = 'profile' AND relation_id = a.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) sa ON true
  ORDER BY a.id;
`;

const pool = getPool();
const { rows: allRows } = await pool.query(ALL_USERS_QUERY);
const rows = allRows.filter((u) => !u.email.startsWith("deleted_"));

console.log(`Found ${rows.length} active users (skipped ${allRows.length - rows.length} deleted). Syncing in batches of ${BATCH_SIZE}...`);

let synced = 0;

for (let i = 0; i < rows.length; i += BATCH_SIZE) {
  const batch = rows.slice(i, i + BATCH_SIZE);

  const streamUsers = batch.map((user) => {
    const data = {
      id: user.id,
      name: formatDisplayName(user.last_name, user.first_name, user.middle_name),
      email: user.email.toLowerCase().trim(),
      company: user.company,
      company_name: user.company_name,
      visa_type_descr: user.visa_type_descr,
      batch_no: user.batch_no,
      business_unit: user.business_unit,
      user_type: user.user_type,
    };

    if (user.profile_pic_s3_key) {
      data.image = `https://${env.aws.cloudfrontDomain}/${user.profile_pic_s3_key}`;
    }

    return data;
  });

  await streamClient.upsertUsers(streamUsers);
  synced += batch.length;
  console.log(`  Synced ${synced}/${rows.length}`);
}

console.log("Done.");
await pool.end();
