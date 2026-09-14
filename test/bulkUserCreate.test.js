import test from "node:test";
import assert from "node:assert/strict";

import { normalizeLoginId, TEMP_LOGIN_ID_RE } from "../config/constants.js";
import { classifyBulkRow, registerTempLoginId } from "../utils/bulkUserCreate.js";
import { isActivationAllowedPath, isActivationOtpValid } from "../utils/activation.js";

test("temporary login IDs normalize to the reserved domain", () => {
  assert.equal(normalizeLoginId(" VN24-001 "), "vn24-001@temp.hp.local");
  assert.equal(normalizeLoginId("Worker@example.com"), "worker@example.com");
  assert.equal(TEMP_LOGIN_ID_RE.test("ab"), false);
  assert.equal(TEMP_LOGIN_ID_RE.test("VN24-001"), true);
});

test("bulk rows route by linkage fields", () => {
  assert.equal(classifyBulkRow({}), "missing");
  assert.equal(classifyBulkRow({ user_id: "id", temp_login_id: "temp" }), "conflict");
  assert.equal(classifyBulkRow({ temp_login_id: "temp" }), "create");
  assert.equal(classifyBulkRow({ user_id: "id" }), "update");
});

test("temporary IDs are duplicate-checked case-insensitively within a file", () => {
  const seen = new Set();
  assert.equal(registerTempLoginId(seen, "VN24-001"), true);
  assert.equal(registerTempLoginId(seen, "vn24-001"), false);
});

test("activation OTP rejects mismatch and expiry", () => {
  const future = new Date("2030-01-01T00:10:00Z");
  const past = new Date("2029-12-31T23:50:00Z");
  const now = new Date("2030-01-01T00:00:00Z");
  assert.equal(isActivationOtpValid({ otp_code: "123456", otp_expiry: future }, "123456", now), true);
  assert.equal(isActivationOtpValid({ otp_code: "123456", otp_expiry: future }, "000000", now), false);
  assert.equal(isActivationOtpValid({ otp_code: "123456", otp_expiry: past }, "123456", now), false);
});

test("activation enforcement allow-list is prefix based", () => {
  assert.equal(isActivationAllowedPath("/login/activate/request-otp"), true);
  assert.equal(isActivationAllowedPath("/profile/bu-settings"), true);
  assert.equal(isActivationAllowedPath("/stream/token"), false);
});
