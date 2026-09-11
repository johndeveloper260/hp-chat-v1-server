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
