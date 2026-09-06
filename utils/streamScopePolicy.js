// https://getstream.io/docs/platform/permissions/
// Inspect permission actions, including custom grants, rather than guessing IDs.
const blockedActions = new Set(["SearchUser", "CreateChannel", "UpdateChannelMembers", "JoinChannel"]);
export const restrictScopeGrants = (grants, permissions) => {
  const definitions = new Map(permissions.map((p) => [p.id, p]));
  return Object.fromEntries(Object.entries(grants).map(([role, ids]) => [role,
    ids.filter((id) => {
      if (id.startsWith("!")) return true;
      const permission = definitions.get(id);
      if (!permission) throw new Error(`Unknown permission ${id}; refusing to guess`);
      if (permission.action === "ReadChannel" && !["channel_member", "channel_moderator"].includes(role)) return false;
      return !blockedActions.has(permission.action);
    }),
  ]));
};
