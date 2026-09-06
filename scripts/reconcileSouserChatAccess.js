/**
 * Historical SOUSER memberships must be reconciled during rollout, not only on
 * the next BU revoke. Default is read-only; --apply changes Stream memberships.
 * node --env-file=.env scripts/reconcileSouserChatAccess.js [--apply]
 */
import { getPool } from "../config/getPool.js";
import { pruneOutOfScopeChannels, revokeStreamAccess } from "../services/chatAccessService.js";
const apply = process.argv.includes("--apply");
const pool = getPool();
try {
  const { rows } = await pool.query(`SELECT s.id, a.is_active FROM v4.souser_tbl s JOIN v4.user_account_tbl a ON a.id = s.id`);
  let checked = 0, affected = 0, failed = 0;
  for (const row of rows) {
    try {
      if (apply && row.is_active === false) await revokeStreamAccess(row.id);
      const result = await pruneOutOfScopeChannels(row.id, { dryRun: !apply });
      checked += result.checked;
      affected += result.removed ?? result.wouldRemove;
    } catch { failed++; }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "read-only", accounts: rows.length, channelsChecked: checked, membershipsAffected: affected, failedAccounts: failed }));
  if (failed) process.exitCode = 1;
} finally { await pool.end(); }
