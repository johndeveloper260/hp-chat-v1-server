/**
 * Notification Repository
 *
 * Raw SQL for push tokens (user_push_tokens) and notification history
 * (notification_history_tbl), plus user-account lookup helpers used by
 * the push-notification service functions.
 */
import { getPool } from "../config/getPool.js";

// ── Push tokens ────────────────────────────────────────────────────────────────

export const upsertPushToken = async (userId, expoPushToken, businessUnit) => {
  const { rows } = await getPool().query(
    `INSERT INTO v4.user_push_tokens (user_id, expo_push_token, business_unit, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       expo_push_token = $2,
       business_unit   = $3,
       updated_at      = NOW()
     RETURNING *`,
    [userId, expoPushToken, businessUnit],
  );
  return rows[0];
};

/**
 * Fetch one push token for a user.
 * Pass businessUnit to scope by tenant; omit for cross-tenant lookups.
 */
export const findPushToken = async (userId, businessUnit = null) => {
  const sql = businessUnit
    ? "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = $1 AND business_unit = $2"
    : "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = $1";
  const params = businessUnit ? [userId, businessUnit] : [userId];
  const { rows } = await getPool().query(sql, params);
  return rows[0]?.expo_push_token ?? null;
};

/**
 * Fetch all push tokens for multiple users (deduplication in service layer).
 */
export const findPushTokensForUsers = async (userIds, businessUnit = null) => {
  const sql = businessUnit
    ? "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = ANY($1) AND business_unit = $2"
    : "SELECT expo_push_token FROM v4.user_push_tokens WHERE user_id = ANY($1)";
  const params = businessUnit ? [userIds, businessUnit] : [userIds];
  const { rows } = await getPool().query(sql, params);
  return rows.map((r) => r.expo_push_token);
};

/** Returns number of deleted rows (0 = not found, 1 = deleted). */
export const deletePushToken = async (userId, expoPushToken, businessUnit) => {
  const { rowCount } = await getPool().query(
    `DELETE FROM v4.user_push_tokens
     WHERE user_id = $1 AND expo_push_token = $2 AND business_unit = $3`,
    [userId, expoPushToken, businessUnit],
  );
  return rowCount;
};

// ── User account helpers ───────────────────────────────────────────────────────

/** Returns { preferred_language, business_unit } for the given user. */
export const findUserLangAndBU = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT preferred_language, business_unit FROM v4.user_account_tbl WHERE id = $1",
    [userId],
  );
  return rows[0] ?? { preferred_language: "en", business_unit: null };
};

export const findUserLanguage = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT preferred_language FROM v4.user_account_tbl WHERE id = $1",
    [userId],
  );
  return rows[0]?.preferred_language || "en";
};

export const findUserBusinessUnit = async (userId) => {
  const { rows } = await getPool().query(
    "SELECT business_unit FROM v4.user_account_tbl WHERE id = $1",
    [userId],
  );
  return rows[0]?.business_unit ?? null;
};

// ── Notification history ───────────────────────────────────────────────────────

export const insertNotificationHistory = async (
  userId,
  title,
  body,
  type,
  rowId,
  businessUnit,
) => {
  await getPool().query(
    `INSERT INTO v4.notification_history_tbl
       (user_id, title, body, relation_type, relation_id, business_unit)
     VALUES ($1, $2, $3, $4, $5::text, $6)`,
    [userId, title, body, type, rowId, businessUnit],
  );
};

export const findUserNotifications = async (userId, businessUnit) => {
  const { rows } = await getPool().query(
    `SELECT * FROM v4.notification_history_tbl
     WHERE user_id = $1 AND business_unit = $2
     ORDER BY created_at DESC LIMIT 100`,
    [userId, businessUnit],
  );
  return rows;
};

export const markNotificationRead = async (notificationId, userId, businessUnit) => {
  await getPool().query(
    `UPDATE v4.notification_history_tbl
     SET is_read = true
     WHERE notification_id = $1 AND user_id = $2 AND business_unit = $3`,
    [notificationId, userId, businessUnit],
  );
};
