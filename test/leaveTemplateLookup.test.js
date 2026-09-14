/**
 * Leave template lookup scoping.
 *
 * A coordinator applying on behalf belongs to a different company than the
 * form. The by-ID lookup must therefore be able to scope to the business unit
 * alone; pinning it to the caller's own company turned every on-behalf
 * template fetch that omitted company_id into a 404 ("no forms available").
 *
 * No DB fixture harness exists, so the pool is replaced with a recorder and the
 * assertions are on the statement and bound parameters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const calls = [];
globalThis.__leaveLookupTestPool = {
  getPool: () => ({ query: async (text, values) => { calls.push({ text, values }); return { rows: [] }; } }),
};
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/repositories/leaveRepository.js") && specifier === "../config/getPool.js") {
      return { url: "leave-lookup-test:getPool", shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url !== "leave-lookup-test:getPool") return next(url, context);
    return { format: "module", shortCircuit: true, source: "export const getPool = globalThis.__leaveLookupTestPool.getPool;" };
  },
});
const leaveRepo = await import("../repositories/leaveRepository.js");
hooks.deregister();
delete globalThis.__leaveLookupTestPool;

const sqlOf = (call) => call.text.replace(/\s+/g, " ");

test("by-ID lookup with a company pins template, BU and company as parameters", async () => {
  calls.length = 0;
  await leaveRepo.findLeaveTemplate({ templateId: "t-1", company: "c-1", businessUnit: "BU", publishedOnly: true });
  const sql = sqlOf(calls[0]);
  assert.match(sql, /template_id = \$1/);
  assert.match(sql, /business_unit = \$2/);
  assert.match(sql, /company_id = \$4/);
  assert.deepEqual(calls[0].values, ["t-1", "BU", true, "c-1"]);
});

test("by-ID lookup without a company scopes to the business unit only", async () => {
  calls.length = 0;
  await leaveRepo.findLeaveTemplate({ templateId: "t-1", company: null, businessUnit: "BU", publishedOnly: false });
  const sql = sqlOf(calls[0]);
  assert.match(sql, /template_id = \$1/);
  assert.match(sql, /business_unit = \$2/);
  assert.doesNotMatch(sql, /company_id/);
  assert.match(sql, /is_active = true/);
  assert.deepEqual(calls[0].values, ["t-1", "BU", false]);
});

test("latest-template lookup still requires a company", async () => {
  calls.length = 0;
  await leaveRepo.findLeaveTemplate({ company: "c-1", businessUnit: "BU", publishedOnly: true });
  const sql = sqlOf(calls[0]);
  assert.match(sql, /company_id = \$1 AND business_unit = \$2/);
  assert.deepEqual(calls[0].values, ["c-1", "BU", true]);
});
