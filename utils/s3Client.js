/**
 * Shared AWS S3 Client & Helpers
 *
 * Centralises S3 construction so every service reuses the same singleton.
 * Import `getS3Client`, `deleteFromS3`, or `getPresignedUrl` instead of
 * constructing an S3Client inline in each controller/service.
 */
import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import env from "../config/env.js";

let _client = null;

/** Returns the shared S3 singleton, constructing it on first call. */
export const getS3Client = () => {
  if (!_client) {
    _client = new S3Client({
      region: env.aws.region,
      credentials: {
        accessKeyId:     env.aws.accessKeyId,
        secretAccessKey: env.aws.secretAccessKey,
      },
      requestHandler: new NodeHttpHandler({ connectionTimeout: 5000 }),
      responseChecksumValidation: "WHEN_REQUIRED",
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
  }
  return _client;
};

/**
 * Delete a single object from S3.
 *
 * @param {string} s3Key    - The object key (path) inside the bucket.
 * @param {string} [bucket] - Bucket name; defaults to env.aws.bucket.
 */
export const deleteFromS3 = async (s3Key, bucket = env.aws.bucket) => {
  if (!s3Key) return;
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: s3Key });
  await getS3Client().send(command);
};

/**
 * Generate a short-lived presigned GET URL for a private S3 object.
 *
 * @param {string} bucket
 * @param {string} s3Key
 * @param {number} [expiresIn=3600] - Seconds until expiry.
 * @returns {Promise<string>} Presigned URL string.
 */
export const getPresignedUrl = async (bucket, s3Key, expiresIn = 3600) => {
  const command = new GetObjectCommand({ Bucket: bucket, Key: s3Key });
  return getSignedUrl(getS3Client(), command, {
    expiresIn,
    signableHeaders: new Set(["host"]),
  });
};
