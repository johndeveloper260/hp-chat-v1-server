import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { StreamChat } from "stream-chat";
import dotenv from "dotenv";

import { getPool } from "../config/getPool.js";

dotenv.config();

const streamClient = StreamChat.getInstance(
  process.env.STREAM_API_KEY,
  process.env.STREAM_API_SECRET,
);

const s3Client = new S3Client({
  region: process.env.REACT_APP_AWS_REGION,
  credentials: {
    accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    connectionTimeout: 5000,
  }),
  responseChecksumValidation: "WHEN_REQUIRED",
  requestChecksumCalculation: "WHEN_REQUIRED",
});

const STREAM_SYNC_QUERY = `
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
    sa.s3_key as profile_pic_s3_key,
    sa.s3_bucket as profile_pic_s3_bucket
  FROM v4.user_account_tbl a
  LEFT JOIN v4.user_profile_tbl p ON a.id = p.user_id
  LEFT JOIN v4.company_tbl c ON p.company::uuid = c.company_id
  LEFT JOIN v4.user_visa_info_tbl v ON a.id = v.user_id
  LEFT JOIN v4.visa_list_tbl vl ON (
    v.visa_type = vl.code
    AND a.business_unit = vl.business_unit
  )
  LEFT JOIN LATERAL (
    SELECT s3_key, s3_bucket
    FROM v4.shared_attachments
    WHERE relation_type = 'profile'
      AND relation_id = a.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) sa ON true
  WHERE a.id = $1;
`;

/**
 * Sync a user's profile to GetStream Chat.
 * Queries the DB for full profile + visa + company data, generates
 * a signed S3 URL for the profile picture, and upserts to Stream.
 *
 * @param {string} userId - The user's UUID
 * @param {import('pg').PoolClient} [dbClient] - Optional pg client (use when inside a transaction)
 */
export const syncUserToStream = async (userId, dbClient) => {
  const queryRunner = dbClient || getPool();

  const result = await queryRunner.query(STREAM_SYNC_QUERY, [userId]);

  if (result.rows.length === 0) {
    console.warn(`syncUserToStream: No user found for id ${userId}`);
    return;
  }

  const user = result.rows[0];
  const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
  const normalizedEmail = user.email.toLowerCase().trim();

  // Generate profile picture signed URL if exists
  let profileImageUrl = null;
  if (user.profile_pic_s3_key && user.profile_pic_s3_bucket) {
    try {
      const command = new GetObjectCommand({
        Bucket: user.profile_pic_s3_bucket,
        Key: user.profile_pic_s3_key,
      });

      profileImageUrl = await getSignedUrl(s3Client, command, {
        expiresIn: 86400, // 24 hours
        signableHeaders: new Set(["host"]),
      });
    } catch (error) {
      console.error("syncUserToStream: Error generating profile picture URL:", error);
    }
  }

  const streamUserData = {
    id: user.id,
    name: fullName,
    email: normalizedEmail,
    company: user.company,
    company_name: user.company_name,
    visa_type_descr: user.visa_type_descr,
    batch_no: user.batch_no,
    business_unit: user.business_unit,
    user_type: user.user_type,
  };

  if (profileImageUrl) {
    streamUserData.image = profileImageUrl;
  }

  await streamClient.upsertUser(streamUserData);
};
