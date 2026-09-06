import test from "node:test";
import assert from "node:assert/strict";
import { restrictScopeGrants } from "../utils/streamScopePolicy.js";
test("Stream scope policy removes custom bypass grants while retaining messaging and moderation", () => {
  const grants = { user: ["custom-create", "search", "send"], channel_member: ["members", "send"], admin: ["custom-create", "delete"] };
  const definitions = [{ id: "custom-create", action: "CreateChannel" }, { id: "search", action: "SearchUser" }, { id: "members", action: "UpdateChannelMembers" }, { id: "send", action: "CreateMessage" }, { id: "delete", action: "DeleteMessage" }];
  assert.deepEqual(restrictScopeGrants(grants, definitions), { user: ["send"], channel_member: ["send"], admin: ["delete"] });
  assert.throws(() => restrictScopeGrants({ user: ["unknown"] }, definitions));
});

test("removed owners cannot retain channel reads through a global owner grant", () => {
  const defs = [{ id: "read-owner", action: "ReadChannel", owner: true }, { id: "read", action: "ReadChannel" }];
  assert.deepEqual(restrictScopeGrants({ user: ["read-owner"], channel_member: ["read"] }, defs),
    { user: [], channel_member: ["read"] });
});
