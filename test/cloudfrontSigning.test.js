/**
 * CloudFront signing outside /files.
 *
 * A SharePoint file linked into an announcement or chat keeps its "sharepoint/"
 * key, so the attachment view URL must be signed too — CloudFront refuses
 * unsigned requests on that path. Every other attachment (and profile
 * pictures) stays a plain public URL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

const attachments = {
  "chat-sp":     { relation_type: "chat_message",  relation_id: "ch1", s3_key: "sharepoint/f1/1-a.pdf", s3_bucket: "b" },
  "ann-sp":      { relation_type: "announcements", relation_id: "42",  s3_key: "sharepoint/f1/2-b.pdf", s3_bucket: "b" },
  "ann-own":     { relation_type: "announcements", relation_id: "42",  s3_key: "uploads/gen/announcements/42/photo.png", s3_bucket: "b" },
  "chat-own":    { relation_type: "chat_message",  relation_id: "ch1", s3_key: "uploads/gen/chat_message/ch1/c.png", s3_bucket: "b" },
  "inquiry-own": { relation_type: "inquiries",     relation_id: "T1",  s3_key: "uploads/gen/inquiries/T1/r.pdf", s3_bucket: "b" },
  "profile":     { relation_type: "profile",       relation_id: "u1",  s3_key: "uploads/gen/profile/u1/avatar.jpg", s3_bucket: "b" },
};

const awsEnv = { cloudfrontDomain: "cdn.test", bucket: "b" };
const dependencies = {
  "../config/env.js": { default: { aws: awsEnv, stream: {} } },
  "stream-chat": {
    StreamChat: { getInstance: () => ({
      channel: () => ({ queryMembers: async () => ({ members: [{ user_id: "u1" }] }) }),
    }) },
  },
  "@aws-sdk/s3-request-presigner": { getSignedUrl: async () => "put-url" },
  "@aws-sdk/client-s3": { PutObjectCommand: class {}, GetObjectCommand: class {} },
  "../utils/s3Client.js": {
    getS3Client: () => ({}), deleteFromS3: async () => {},
    getPresignedUrl: async (_b, key) => `presigned:${key}`,
  },
  "./profileService.js": { clearAvatarCache: () => {} },
  "../repositories/attachmentRepository.js": {
    findAttachmentById: async (id) => attachments[id] ?? null,
    checkParentBU: async () => 1,
  },
  "./sharepointService.js": { findAccessibleFile: async () => ({}) },
  "../repositories/commentsRepository.js": {},
  "./notificationService.js": { createNotification: async () => {} },
  "./announcementAccess.js": { isAnnouncementVisible: async () => true, canModifyAnnouncement: async () => true },
};

globalThis.__cloudfrontSigningTestDependencies = dependencies;
const PARENTS = ["/services/attachmentService.js", "/utils/cloudfrontSigner.js"];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? new URL(context.parentURL).pathname : "";
    if (PARENTS.some((p) => parent.endsWith(p)) && dependencies[specifier]) {
      return { url: `cf-test:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("cf-test:")) return next(url, context);
    const key = url.slice("cf-test:".length);
    const ref = (name) => `globalThis.__cloudfrontSigningTestDependencies[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    const source = Object.keys(dependencies[key]).map((name) =>
      name === "default" ? `export default ${ref(name)};` : `export const ${name} = ${ref(name)};`).join("\n");
    return { format: "module", shortCircuit: true, source };
  },
});
const { getViewingUrl } = await import("../services/attachmentService.js");
const signer = await import("../utils/cloudfrontSigner.js");
hooks.deregister();

const view = (id) => getViewingUrl(id, "gen", "u1");

const withSigningKeys = async (fn) => {
  awsEnv.cloudfrontKeyPairId = "K2TESTKEYPAIR";
  awsEnv.cloudfrontPrivateKey = pem;
  try { await fn(); } finally {
    delete awsEnv.cloudfrontKeyPairId;
    delete awsEnv.cloudfrontPrivateKey;
  }
};

const assertSigned = (url, resource) => {
  const parsed = new URL(url);
  assert.equal(`${parsed.origin}${parsed.pathname}`, resource);
  for (const param of ["Expires", "Signature", "Key-Pair-Id"]) {
    assert.ok(parsed.searchParams.get(param), `missing ${param} in ${url}`);
  }
};

test("a SharePoint file linked into chat or an announcement gets a signed view URL", async () => {
  await withSigningKeys(async () => {
    assertSigned(await view("chat-sp"), "https://cdn.test/sharepoint/f1/1-a.pdf");
    assertSigned(await view("ann-sp"), "https://cdn.test/sharepoint/f1/2-b.pdf");
  });
});

test("ordinary announcement, chat, inquiry and profile attachments stay unsigned", async () => {
  await withSigningKeys(async () => {
    assert.equal(await view("ann-own"), "https://cdn.test/uploads/gen/announcements/42/photo.png");
    assert.equal(await view("chat-own"), "https://cdn.test/uploads/gen/chat_message/ch1/c.png");
    assert.equal(await view("inquiry-own"), "https://cdn.test/uploads/gen/inquiries/T1/r.pdf");
    assert.equal(await view("profile"), "https://cdn.test/uploads/gen/profile/u1/avatar.jpg");
  });
});

test("without signing keys a linked SharePoint file falls back to the plain URL", async () => {
  assert.equal(await view("chat-sp"), "https://cdn.test/sharepoint/f1/1-a.pdf");
});

test("cloudfrontUrl only signs keys under the sharepoint/ prefix", async () => {
  await withSigningKeys(async () => {
    assertSigned(signer.cloudfrontUrl("sharepoint/x/y.pdf"), "https://cdn.test/sharepoint/x/y.pdf");
    assert.equal(signer.cloudfrontUrl("uploads/gen/sharepoint/y.pdf"), "https://cdn.test/uploads/gen/sharepoint/y.pdf");
    assert.equal(signer.cloudfrontUrl("profile/abc.jpg"), "https://cdn.test/profile/abc.jpg");
  });
});

test("signFileUrl honours a custom TTL", async () => {
  await withSigningKeys(async () => {
    const expires = Number(new URL(signer.signFileUrl("sharepoint/x/y.pdf", 60)).searchParams.get("Expires"));
    const now = Math.floor(Date.now() / 1000);
    assert.ok(expires > now + 50 && expires <= now + 61);
  });
});

test("CLOUDFRONT_PRIVATE_KEY given on one line with literal \\n is turned back into a PEM", async () => {
  const vars = {
    DB_HOST: "h", DB_USER: "u", DB_PASS: "p", DB_DATABASE: "d",
    SECRET_TOKEN: "s", STREAM_API_KEY: "k", STREAM_API_SECRET: "x",
    TRANSLATION_PROVIDER: "google",
    CLOUDFRONT_KEY_PAIR_ID: "K2TESTKEYPAIR",
    CLOUDFRONT_PRIVATE_KEY: pem.trim().replace(/\n/g, "\\n"),
  };
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try {
    const { default: env } = await import(`../config/env.js?oneline=${Date.now()}`);
    assert.equal(env.aws.cloudfrontKeyPairId, "K2TESTKEYPAIR");
    assert.equal(env.aws.cloudfrontPrivateKey, pem.trim());
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
