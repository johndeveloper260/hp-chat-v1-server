/**
 * CloudFront URL signing for SharePoint (Files) objects.
 *
 * Files live under the "sharepoint/" S3 prefix, which CloudFront serves through
 * its own behavior restricted to a trusted key group — an unsigned URL for those
 * keys gets 403. Everything else on the same distribution (profile pictures,
 * announcement / chat / inquiry / task attachments) stays public and unsigned.
 *
 * If CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY are not set, signFileUrl
 * falls back to the plain URL so environments without keys keep working while
 * the restriction is rolled out.
 */
import { getSignedUrl } from "@aws-sdk/cloudfront-signer";
import env from "../config/env.js";

export const SHAREPOINT_KEY_PREFIX = "sharepoint/";
export const FILE_URL_TTL_SECONDS = 300;

export const isSharepointKey = (s3Key) =>
  typeof s3Key === "string" && s3Key.startsWith(SHAREPOINT_KEY_PREFIX);

const hasSigningKeys = () =>
  Boolean(env.aws.cloudfrontKeyPairId && env.aws.cloudfrontPrivateKey);

if (env.aws.cloudfrontDomain && !hasSigningKeys()) {
  console.warn(
    "[cloudfrontSigner] CLOUDFRONT_KEY_PAIR_ID / CLOUDFRONT_PRIVATE_KEY not set — " +
      "SharePoint file URLs will be served UNSIGNED.",
  );
}

/** Returns a canned-policy signed CloudFront URL for s3Key, valid for ttlSeconds. */
export const signFileUrl = (s3Key, ttlSeconds = FILE_URL_TTL_SECONDS) => {
  const url = `https://${env.aws.cloudfrontDomain}/${s3Key}`;
  if (!hasSigningKeys()) return url;

  return getSignedUrl({
    url,
    keyPairId: env.aws.cloudfrontKeyPairId,
    privateKey: env.aws.cloudfrontPrivateKey,
    dateLessThan: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  });
};

/**
 * The CloudFront URL for any object: signed for "sharepoint/" keys, plain for
 * everything else. Callers must already have checked cloudfrontDomain is set.
 */
export const cloudfrontUrl = (s3Key) =>
  isSharepointKey(s3Key) ? signFileUrl(s3Key) : `https://${env.aws.cloudfrontDomain}/${s3Key}`;
