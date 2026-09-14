import test from "node:test";
import assert from "node:assert/strict";
import { buildCompanyFlags } from "../utils/sessionFlags.js";

// /profile/bu-settings merges this object over the login payload on the
// clients, so the keys must match loginService exactly and every flag must
// resolve to a boolean — an undefined key would leave the stale cached value.
const LOGIN_KEYS = ["company", "company_name", "company_ticketing", "company_flight_tracker", "company_form"];

test("company flags mirror the login payload keys", () => {
  const flags = buildCompanyFlags({
    company: "c-1", company_name: "片山工業株式会社",
    company_ticketing: true, company_flight_tracker: false, company_form: true,
  });
  assert.deepEqual(Object.keys(flags).sort(), [...LOGIN_KEYS].sort());
  assert.equal(flags.company_form, true);
  assert.equal(flags.company_name, "片山工業株式会社");
});

test("a user with no profile or company row gets every flag off, not undefined", () => {
  for (const row of [null, undefined, {}, { company: "c-1", company_form: null }]) {
    const flags = buildCompanyFlags(row);
    assert.equal(flags.company_form, false);
    assert.equal(flags.company_ticketing, false);
    assert.equal(flags.company_flight_tracker, false);
    for (const key of LOGIN_KEYS) assert.notEqual(flags[key], undefined, key);
  }
});
