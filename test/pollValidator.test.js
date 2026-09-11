import test from "node:test";
import assert from "node:assert/strict";
import { pollInputSchema, pollRespondSchema } from "../validators/feedValidator.js";

const valid = { question: "Choice?", options: ["One", "Two"] };
test("poll input validates bounds, uniqueness and defaults", () => {
  assert.equal(pollInputSchema.safeParse({ ...valid, options: ["One"] }).success, false);
  assert.equal(pollInputSchema.safeParse({ ...valid, options: Array.from({length:11},(_,i)=>String(i)) }).success, false);
  assert.equal(pollInputSchema.safeParse({ ...valid, options: [" One ", "one"] }).success, false);
  assert.equal(pollInputSchema.safeParse({ ...valid, question: " " }).success, false);
  assert.equal(pollInputSchema.safeParse({ ...valid, closes_at: "tomorrow" }).success, false);
  assert.equal(pollInputSchema.parse(valid).allow_multiple, false);
});
test("poll options accept bare labels or { label, requires_note } and normalise to objects", () => {
  const parsed = pollInputSchema.parse({ ...valid, options: [" One ", { label: "Other", requires_note: true }, { label: "Plain" }] });
  assert.deepEqual(parsed.options, [
    { label: "One", requires_note: false },
    { label: "Other", requires_note: true },
    { label: "Plain", requires_note: false },
  ]);
  assert.equal(pollInputSchema.safeParse({ ...valid, options: ["One", { label: "one" }] }).success, false, "uniqueness spans both forms");
  assert.equal(pollInputSchema.safeParse({ ...valid, options: ["One", { requires_note: true }] }).success, false, "label is required");
});
test("poll responses carry optional per-option notes", () => {
  const uuid = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(pollRespondSchema.parse({ option_ids: [uuid] }).notes, {});
  assert.deepEqual(pollRespondSchema.parse({ option_ids: [uuid], notes: { [uuid]: "  why  " } }).notes, { [uuid]: "why" });
  assert.equal(pollRespondSchema.safeParse({ option_ids: [uuid], notes: { nope: "x" } }).success, false);
  assert.equal(pollRespondSchema.safeParse({ option_ids: [uuid], notes: { [uuid]: "x".repeat(501) } }).success, false);
});
test("poll responses require one to ten UUIDs", () => {
  assert.equal(pollRespondSchema.safeParse({ option_ids: [] }).success, false);
  assert.equal(pollRespondSchema.safeParse({ option_ids: ["no"] }).success, false);
  assert.equal(pollRespondSchema.safeParse({ option_ids: Array(11).fill("00000000-0000-4000-8000-000000000001") }).success, false);
});
