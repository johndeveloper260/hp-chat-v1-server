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
test("poll responses require one to ten UUIDs", () => {
  assert.equal(pollRespondSchema.safeParse({ option_ids: [] }).success, false);
  assert.equal(pollRespondSchema.safeParse({ option_ids: ["no"] }).success, false);
  assert.equal(pollRespondSchema.safeParse({ option_ids: Array(11).fill("00000000-0000-4000-8000-000000000001") }).success, false);
});
