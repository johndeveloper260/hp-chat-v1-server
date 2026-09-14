import test from "node:test";
import assert from "node:assert/strict";
import { isPollOpen, projectPollForViewer } from "../utils/pollProjection.js";

const now = new Date("2026-09-11T12:00:00Z");
const announcement = { active: true, date_from: "2026-09-01", date_to: "2026-09-30" };
const poll = { is_locked:false, closes_at:"2026-09-12T00:00:00Z", total_respondents:2, options:[{option_id:"x",count:2}] };
test("poll projection exposes counts only to officers and admins", () => {
  for (const userType of ["USER","SOUSER"]) {
    const p=projectPollForViewer(poll,announcement,{userType},now);
    assert.equal("total_respondents" in p,false); assert.equal("count" in p.options[0],false);
  }
  for (const userType of ["OFFICER","ADMIN"]) assert.equal(projectPollForViewer(poll,announcement,{userType},now).options[0].count,2);
  assert.equal(projectPollForViewer(null,announcement,{userType:"ADMIN"},now),null);
});
test("poll open state combines manual, scheduled and bulletin windows", () => {
  assert.equal(isPollOpen(poll,announcement,now),true);
  assert.equal(isPollOpen({...poll,is_locked:true},announcement,now),false);
  assert.equal(isPollOpen({...poll,closes_at:"2026-09-10T00:00:00Z"},announcement,now),false);
  assert.equal(isPollOpen(poll,{...announcement,active:false},now),false);
  assert.equal(isPollOpen(poll,{...announcement,date_to:"2026-09-10"},now),false);
});

test("poll projection whitelists every poll and option field for all four roles", () => {
  const input = { ...poll, poll_id: "p", question: "Q", allow_multiple: false,
    created_by: "secret", locked_by: "secret", updated_by: "secret", business_unit: "secret", announcement_id: 42,
    unknown_future_column: "secret", my_option_ids: ["x"], my_notes: { x: "mine" },
    options: [{ option_id: "x", label: "A", sort_order: 0, count: 2, requires_note: true, internal_note: "secret" }] };
  const keys = ["poll_id", "question", "allow_multiple", "closes_at", "is_locked", "is_open", "has_responses", "options", "my_option_ids", "my_notes", "has_responded"];
  for (const userType of ["USER", "SOUSER", "OFFICER", "ADMIN"]) {
    const elevated = ["OFFICER", "ADMIN"].includes(userType);
    const output = projectPollForViewer(input, announcement, { userType }, now);
    assert.deepEqual(Object.keys(output).sort(), [...keys, ...(elevated ? ["total_respondents"] : [])].sort());
    assert.deepEqual(Object.keys(output.options[0]).sort(), ["option_id", "label", "sort_order", "requires_note", ...(elevated ? ["count"] : [])].sort());
    assert.deepEqual(output.my_notes, { x: "mine" });
  }
});

test("poll closes exactly at its deadline and respects future bulletin dates", () => {
  assert.equal(isPollOpen({ ...poll, closes_at: now.toISOString() }, announcement, now), false);
  assert.equal(isPollOpen(poll, { ...announcement, date_from: "2026-09-12" }, now), false);
});
