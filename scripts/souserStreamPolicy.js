/**
 * Read-only by default. Run against DEV after deploying both clients and server.
 * node --env-file=.env scripts/souserStreamPolicy.js --check
 * node --env-file=.env scripts/souserStreamPolicy.js --apply /absolute/backup.json
 * node --env-file=.env scripts/souserStreamPolicy.js --restore /absolute/backup.json
 * No credentials are printed or stored in the backup.
 */
import { StreamChat } from "stream-chat";
import { writeFile, readFile } from "node:fs/promises";
import { restrictScopeGrants } from "../utils/streamScopePolicy.js";

const run = async () => {
  const chat = StreamChat.getInstance(process.env.STREAM_API_KEY, process.env.STREAM_API_SECRET, { timeout: 15000 });
  const [settings, types, definitions] = await Promise.all([
    chat.getAppSettings(), chat.listChannelTypes(), chat.listPermissions(),
  ]);
  const app = settings.app;
  if (app.permission_version !== "v2") throw new Error("Permissions v2 required; migrate and review existing policies first");
  if (!app.grants || !types.channel_types || !definitions.permissions) throw new Error("Missing permission configuration");
  const channelTypes = Object.fromEntries(Object.entries(types.channel_types).map(([type, config]) => {
    if (!config.grants) throw new Error("Missing channel-type grants");
    return [type, config.grants];
  }));
  const snapshot = { appGrants: app.grants, channelTypes,
    userSearchDisallowedRoles: app.user_search_disallowed_roles ?? [] };
  const appGrants = restrictScopeGrants(app.grants, definitions.permissions);
  const channelGrants = Object.fromEntries(Object.entries(channelTypes).map(([type, grants]) => [type, restrictScopeGrants(grants, definitions.permissions)]));
  const disallowed = [...new Set([...snapshot.userSearchDisallowedRoles, ...Object.keys(app.grants), ...Object.values(channelTypes).flatMap((grants) => Object.keys(grants))])];
  const changes = [];
  for (const [scope, before, after] of [["app", app.grants, appGrants], ...Object.entries(channelTypes).map(([type, grants]) => [type, grants, channelGrants[type]])]) {
    for (const role of Object.keys(before)) {
      const removed = before[role].filter((grant) => !after[role].includes(grant));
      if (removed.length) changes.push({ scope, role, removed });
    }
  }
  console.log(JSON.stringify({ permissionVersion: app.permission_version, changes,
    note: "Also audit channel-level config_overrides, new channel types before enabling them before rollout." }, null, 2));
  const mode = process.argv[2] ?? "--check";
  const backupPath = process.argv[3];
  if (mode === "--check") return;
  if (!["--apply", "--restore"].includes(mode) || !backupPath?.startsWith("/")) throw new Error("Specify --apply or --restore and an absolute backup path");
  if (mode === "--restore") {
    const previous = JSON.parse(await readFile(backupPath, "utf8"));
    if (!previous.channelTypes || !previous.appGrants) throw new Error("Invalid backup");
    await chat.updateAppSettings({ grants: previous.appGrants, user_search_disallowed_roles: previous.userSearchDisallowedRoles });
    for (const [type, grants] of Object.entries(previous.channelTypes)) await chat.updateChannelType(type, { grants });
    console.log("Restored saved grants. Recheck before enabling SOUSER.");
    return;
  }
  await writeFile(backupPath, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o600 });
  await chat.updateAppSettings({ grants: appGrants, user_search_disallowed_roles: disallowed });
  for (const [type, grants] of Object.entries(channelGrants)) await chat.updateChannelType(type, { grants });
  const [verifiedApp, verifiedTypes] = await Promise.all([chat.getAppSettings(), chat.listChannelTypes()]);
  for (const grants of [verifiedApp.app.grants, ...Object.values(verifiedTypes.channel_types).map((type) => type.grants)]) {
    if (JSON.stringify(grants) !== JSON.stringify(restrictScopeGrants(grants, definitions.permissions))) throw new Error("Policy verification failed; retain backup and investigate");
  }
  console.log("Scope grants applied and read back. Test client-token bypass attempts before activation.");
};
run().catch((error) => {
  // SDK error objects may contain request headers. Never print them.
  console.error(`Stream policy operation failed (${error.statusCode ?? error.code ?? error.name}). Configuration may be partial; use the saved backup if an apply was attempted.`);
  process.exitCode = 1;
});
