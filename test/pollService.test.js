import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Load the real service with isolated I/O boundaries. No credentials, network,
// production pool, notification fan-out, or application changes are needed.
let state;
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const reset = () => {
  state = {
    row: { row_id: 1, business_unit: "BU", active: true },
    viewer: { id: id(1), userType: "USER" },
    poll: { poll_id: id(9), question: "Q", allow_multiple: false, options: [
      { option_id: id(2), label: "A" }, { option_id: id(3), label: "Other", requires_note: true },
    ] },
    existing: { option_ids: [], notes: {}, responded_at: null }, writes: 0,
    canModify: true, canRead: true,
  };
};
const dependencies = {
  "../config/getPool.js": { getPool: () => ({ connect: async () => ({ query: async () => ({}), release() {} }) }) },
  "../utils/getUserLanguage.js": { getUserLanguage: async () => "en" },
  "../utils/s3Client.js": { deleteFromS3: async () => {} },
  "./notificationService.js": { sendNotificationToMultipleUsers: async () => {} },
  "./announcementAccess.js": {
    resolveViewer: async () => state.viewer,
    loadVisibleAnnouncement: async () => ({ row: state.row, viewer: state.viewer }),
    assertCanWrite() {}, canModifyAnnouncement: async () => state.canModify,
    canReadPollResults: async () => state.canRead,
  },
  "../repositories/feedRepository.js": {
    updateAnnouncement: async () => state.row,
  },
  "../repositories/pollRepository.js": {
    findPollByAnnouncement: async () => state.poll,
    findMyResponse: async () => state.existing,
    replaceUserResponse: async ({ optionIds, notes }) => {
      state.writes++;
      return { option_ids: optionIds, notes, responded_at: "changed" };
    },
    deleteUserResponse: async () => { state.writes++; },
    deletePoll: async () => { state.writes++; },
    replacePollDefinition: async () => { state.writes++; },
    updatePollClosesAt: async () => { state.writes++; },
    setPollLock: async (_id, locked, by) => ({ poll_id: state.poll.poll_id, is_locked: locked, locked_by: by }),
  },
};
globalThis.__pollServiceTestDependencies = dependencies;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL?.endsWith("/services/feedService.js") && dependencies[specifier]) {
      return { url: `poll-test:${specifier}`, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.startsWith("poll-test:")) return next(url, context);
    const key = url.slice("poll-test:".length);
    return { format: "module", shortCircuit: true, source: Object.keys(dependencies[key]).map((name) =>
      `export const ${name} = globalThis.__pollServiceTestDependencies[${JSON.stringify(key)}][${JSON.stringify(name)}];`).join("\n") };
  },
});
const service = await import("../services/feedService.js");
hooks.deregister();
delete globalThis.__pollServiceTestDependencies;
const respond = (optionIds, notes) => service.respondToPoll({ rowId: 1, optionIds, notes, user: { id: id(1) } });
const rejectsCode = (fn, code) => assert.rejects(fn, (err) => err.messageKey === code || err.errorCode === code || err.translationKey === code);

test("duplicate choices on single-select return option_invalid", async () => {
  reset();
  await rejectsCode(() => respond([id(2), id(2)]), "api_errors.poll.option_invalid");
});

test("unchanged multi-select notes are a no-op regardless of option order", async () => {
  reset(); state.poll.allow_multiple = true;
  state.existing = { option_ids: [id(2), id(3)], notes: { [id(2)]: "A", [id(3)]: "B" }, responded_at: "original" };
  const result = await respond([id(3), id(2)], { [id(3)]: "B", [id(2)]: "A" });
  assert.equal(result.responded_at, "original"); assert.equal(state.writes, 0);
});

test("required notes, foreign options, and single-select cardinality reject before writing", async () => {
  reset();
  await rejectsCode(() => respond([id(3)], { [id(3)]: "   " }), "api_errors.poll.note_required");
  await rejectsCode(() => respond([id(8)]), "api_errors.poll.option_invalid");
  await rejectsCode(() => respond([id(2), id(3)]), "api_errors.poll.multiple_not_allowed");
  assert.equal(state.writes, 0);
});

test("locked, closed, inactive and future bulletins reject responses and withdrawals", async () => {
  for (const kind of ["locked", "scheduled", "inactive", "future", "expired"]) {
    reset();
    if (kind === "locked") state.poll.is_locked = true;
    if (kind === "scheduled") state.poll.closes_at = "2000-01-01T00:00:00Z";
    if (kind === "inactive") state.row.active = false;
    if (kind === "future") state.row.date_from = "2999-01-01";
    if (kind === "expired") state.row.date_to = "2000-01-01";
    const code = `api_errors.poll.${kind === "locked" ? "locked" : "closed"}`;
    await rejectsCode(() => respond([id(2)]), code);
    await rejectsCode(() => service.withdrawPollResponse({ rowId: 1, user: { id: id(1) } }), code);
    assert.equal(state.writes, 0);
  }
});

test("definition and removal freeze while responses exist; close-only updates remain legal", async () => {
  for (const change of ["question", "requires_note", "allow_multiple", "remove", "close"]) {
    reset(); state.poll.has_responses = true;
    const poll = { question: "Q", allow_multiple: false, options: state.poll.options.map((o) => ({ ...o })) };
    if (change === "question") poll.question = "Changed";
    if (change === "requires_note") poll.options[0].requires_note = true;
    if (change === "allow_multiple") poll.allow_multiple = true;
    if (change === "close") poll.closes_at = "2999-01-01T00:00:00Z";
    const update = () => service.updateAnnouncement({ rowId: 1, user: { id: id(1) }, body: { poll: change === "remove" ? null : poll } });
    if (change === "close") { await update(); assert.equal(state.writes, 1); }
    else { await rejectsCode(update, "api_errors.poll.has_responses"); assert.equal(state.writes, 0); }
  }
});

test("poll management denial is 404 for lock, results and export", async () => {
  reset(); state.canModify = state.canRead = false;
  for (const name of ["setPollLock", "getPollResults", "exportPollResults"]) {
    await assert.rejects(() => service[name]({ rowId: 1, user: { id: id(1) }, locked: true }), (err) => err.statusCode === 404);
  }
});
