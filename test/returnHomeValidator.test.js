import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelReturnHomeSchema,
  createReturnHomeSchema,
  updateReturnHomeSchema,
} from "../validators/returnHomeValidator.js";

test("create only accepts user-controlled Draft and Pending states", () => {
  assert.equal(createReturnHomeSchema.safeParse({ status: "Draft" }).success, true);
  assert.equal(createReturnHomeSchema.safeParse({ status: "Pending" }).success, true);
  assert.equal(createReturnHomeSchema.safeParse({ status: "Approved" }).success, false);
  assert.equal(createReturnHomeSchema.safeParse({ status: "Cancelled" }).success, false);
});

test("general update accepts persisted statuses without granting a transition", () => {
  assert.deepEqual(
    updateReturnHomeSchema.parse({
      details: "Updated details",
      status: "Pending",
    }),
    { details: "Updated details", status: "Pending" },
  );
  assert.equal(updateReturnHomeSchema.safeParse({ status: "Approved" }).success, true);
  assert.equal(updateReturnHomeSchema.safeParse({ status: "Rejected" }).success, true);
  assert.equal(updateReturnHomeSchema.safeParse({ status: "Cancelled" }).success, true);
  assert.equal(updateReturnHomeSchema.safeParse({ status: "Unknown" }).success, false);
});

test("general update accepts nullable values from legacy return-home rows", () => {
  assert.deepEqual(
    updateReturnHomeSchema.parse({ currency: null, payment_settled: null }),
    { currency: null, payment_settled: null },
  );
});

test("cancellation requires a non-blank, bounded reason", () => {
  assert.equal(
    cancelReturnHomeSchema.safeParse({ cancellation_reason: "   " }).success,
    false,
  );
  assert.equal(
    cancelReturnHomeSchema.safeParse({ cancellation_reason: "x".repeat(2001) }).success,
    false,
  );
  assert.deepEqual(
    cancelReturnHomeSchema.parse({ cancellation_reason: "  Changed plans  " }),
    { cancellation_reason: "Changed plans" },
  );
});
