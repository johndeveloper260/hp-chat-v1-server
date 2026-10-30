/**
 * SharePoint (Files) company access.
 *
 * "Copy link" URLs (/files/<folderId>?file=<fileId>) open a folder or file by
 * ID, skipping the root listing that used to be the only company filter. A
 * non-officer must be refused (403) for anything under a root folder whose
 * company_ids don't include their company; officers keep full BU access.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

let state;
const reset = () => {
  state = {
    // folderId → { exists, allowed } as returned by findFolderCompanyAccess
    access: {
      "own-root":   { exists: true, allowed: true },
      "own-sub":    { exists: true, allowed: true },
      "other-sub":  { exists: true, allowed: false },
    },
    files: {
      "own-file":   { folder_id: "own-sub",   s3_key: "sharepoint/own-sub/a.pdf",   s3_bucket: "b" },
      "other-file": { folder_id: "other-sub", s3_key: "sharepoint/other-sub/b.pdf", s3_bucket: "b" },
    },
    accessCalls: [],
    poolQueries: [],
    inserted: 0,
  };
};
reset();

const missing = { exists: false, allowed: false };
const dependencies = {
  "../config/getPool.js": {
    getPool: () => ({
      query: async (text, values) => {
        state.poolQueries.push({ text, values });
        return { rows: [state.poolRow], rowCount: 1 };
      },
    }),
  },
  "../config/env.js": { default: { aws: { cloudfrontDomain: "cdn.test", bucket: "b" } } },
  "../utils/s3Client.js": {
    getS3Client: () => ({}), deleteFromS3: async () => {},
    getPresignedUrl: async (_b, key) => `presigned:${key}`,
  },
  "@aws-sdk/s3-request-presigner": { getSignedUrl: async () => "put-url" },
  "@aws-sdk/client-s3": { PutObjectCommand: class {} },
  "../repositories/attachmentRepository.js": { deleteAttachmentsByS3Keys: async () => [] },
  "../repositories/sharepointRepository.js": {
    findFolderCompanyAccess: async (folderId, bu, company) => {
      state.accessCalls.push({ folderId, bu, company });
      return state.access[folderId] ?? missing;
    },
    findFileWithFolderBU: async (id) => state.files[id] ?? null,
    verifyFolderBU: async (id) => (state.access[id] ? 1 : 0),
    findSubFolders: async () => [{ id: "child" }],
    findFilesInFolder: async () => [{ id: "f" }],
    findRootFoldersOfficer: async () => [],
    findRootFoldersForCompany: async () => [],
    findBreadcrumb: async (id) => [{ id, name: "x" }],
    insertFolder: async () => { state.inserted++; return { id: "new" }; },
    insertFile: async () => { state.inserted++; return { id: "new-file" }; },
  },
};

globalThis.__sharepointAccessTestDependencies = dependencies;
const PARENTS = ["/services/sharepointService.js", "/repositories/sharepointRepository.js"];
const hooks = registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? new URL(context.parentURL).pathname : "";
    if (PARENTS.some((p) => parent.endsWith(p)) && dependencies[specifier]) {
      return { url: `sp-test:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("sp-test:")) return next(url, context);
    const key = url.slice("sp-test:".length);
    const ref = (name) => `globalThis.__sharepointAccessTestDependencies[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    const source = Object.keys(dependencies[key]).map((name) =>
      name === "default" ? `export default ${ref(name)};` : `export const ${name} = ${ref(name)};`).join("\n");
    return { format: "module", shortCircuit: true, source };
  },
});
const service = await import("../services/sharepointService.js");
// The real repository, with only getPool stubbed (the service above got the fake one).
const repo = await import("../repositories/sharepointRepository.js?real");
hooks.deregister();

const trainee = { userType: "USER", userCompany: "company-a", businessUnit: "FWARD" };
const officer = { userType: "OFFICER", userCompany: null, businessUnit: "FWARD" };
const admin   = { userType: "admin", userCompany: null, businessUnit: "FWARD" };

const rejectsWith = (fn, status, code) => assert.rejects(fn, (err) => {
  assert.equal(err.statusCode, status);
  if (code) assert.equal(err.errorCode, code);
  return true;
});

// ── getFolders ───────────────────────────────────────────────────────────────

test("a trainee can open a sub-folder under their company's root", async () => {
  reset();
  const result = await service.getFolders({ ...trainee, parent_id: "own-sub" });
  assert.deepEqual(result, { folders: [{ id: "child" }], files: [{ id: "f" }] });
  assert.deepEqual(state.accessCalls, [{ folderId: "own-sub", bu: "FWARD", company: "company-a" }]);
});

test("a trainee opening another company's sub-folder by ID gets 403", async () => {
  reset();
  await rejectsWith(() => service.getFolders({ ...trainee, parent_id: "other-sub" }), 403, "api_errors.files.access_denied");
});

test("a missing or other-BU folder is still 404, not 403", async () => {
  reset();
  await rejectsWith(() => service.getFolders({ ...trainee, parent_id: "nope" }), 404);
});

test("officers and admins skip the company check entirely", async () => {
  reset();
  await service.getFolders({ ...officer, parent_id: "other-sub" });
  await service.getFolders({ ...admin, parent_id: "other-sub" });
  assert.equal(state.accessCalls.length, 0);
});

test("the root listing for a trainee does not run the folder check", async () => {
  reset();
  await service.getFolders({ ...trainee });
  assert.equal(state.accessCalls.length, 0);
});

// ── getFileViewUrl ───────────────────────────────────────────────────────────

test("a trainee gets a view URL for a file in their company's tree", async () => {
  reset();
  const url = await service.getFileViewUrl({ ...trainee, id: "own-file" });
  assert.equal(url, "https://cdn.test/sharepoint/own-sub/a.pdf");
});

test("a trainee is refused a view URL for another company's file, checked via its folder", async () => {
  reset();
  await rejectsWith(() => service.getFileViewUrl({ ...trainee, id: "other-file" }), 403, "api_errors.files.access_denied");
  assert.equal(state.accessCalls[0].folderId, "other-sub");
});

test("an unknown file is 404", async () => {
  reset();
  await rejectsWith(() => service.getFileViewUrl({ ...trainee, id: "nope" }), 404);
});

test("an officer can view any file in the BU", async () => {
  reset();
  assert.equal(await service.getFileViewUrl({ ...officer, id: "other-file" }), "https://cdn.test/sharepoint/other-sub/b.pdf");
});

// ── getBreadcrumb ────────────────────────────────────────────────────────────

test("breadcrumb is refused for another company's folder and allowed for officers", async () => {
  reset();
  await rejectsWith(() => service.getBreadcrumb({ ...trainee, folderId: "other-sub" }), 403);
  assert.deepEqual(await service.getBreadcrumb({ ...officer, folderId: "other-sub" }), { breadcrumb: [{ id: "other-sub", name: "x" }] });
  assert.deepEqual(await service.getBreadcrumb({ ...trainee, folderId: "own-sub" }), { breadcrumb: [{ id: "own-sub", name: "x" }] });
});

// ── Writes into a folder ─────────────────────────────────────────────────────

test("a non-officer cannot create a sub-folder or upload into another company's tree", async () => {
  reset();
  await rejectsWith(() => service.createFolder({ ...trainee, name: "x", parent_id: "other-sub" }), 403);
  await rejectsWith(() => service.generateUploadUrl({ ...trainee, fileName: "a.pdf", fileType: "application/pdf", folderId: "other-sub" }), 403);
  await rejectsWith(() => service.confirmFileUpload({ ...trainee, folder_id: "other-sub", s3_key: "k" }), 403);
  assert.equal(state.inserted, 0);
});

test("the same writes succeed inside the trainee's own tree and for officers anywhere", async () => {
  reset();
  await service.createFolder({ ...trainee, name: "x", parent_id: "own-sub" });
  await service.confirmFileUpload({ ...trainee, folder_id: "own-sub", s3_key: "k" });
  await service.createFolder({ ...officer, name: "x", parent_id: "other-sub" });
  await service.confirmFileUpload({ ...officer, folder_id: "other-sub", s3_key: "k" });
  assert.equal(state.inserted, 4);
});

test("findAccessibleFile (used by the attachment links) applies the same rule", async () => {
  reset();
  await rejectsWith(() => service.findAccessibleFile({ ...trainee, fileId: "other-file" }), 403);
  assert.equal((await service.findAccessibleFile({ ...trainee, fileId: "own-file" })).folder_id, "own-sub");
});

// ── Repository query ─────────────────────────────────────────────────────────

test("findFolderCompanyAccess walks to the root in one query and binds the company as a jsonb array", async () => {
  reset();
  state.poolRow = { hops: 3, allowed: true };
  assert.deepEqual(await repo.findFolderCompanyAccess("f-1", "FWARD", "company-a"), { exists: true, allowed: true });
  assert.equal(state.poolQueries.length, 1);
  const { text, values } = state.poolQueries[0];
  assert.match(text, /WITH RECURSIVE/);
  assert.match(text, /parent_id IS NULL AND company_ids @> \$3::jsonb/);
  assert.deepEqual(values, ["f-1", "FWARD", JSON.stringify(["company-a"])]);
});

test("findFolderCompanyAccess reports missing folders and fails closed on a null result", async () => {
  reset();
  state.poolRow = { hops: 0, allowed: false };
  assert.deepEqual(await repo.findFolderCompanyAccess("x", "FWARD", "company-a"), { exists: false, allowed: false });
  state.poolRow = { hops: 2, allowed: null };
  assert.deepEqual(await repo.findFolderCompanyAccess("x", "FWARD", "company-a"), { exists: true, allowed: false });
});
