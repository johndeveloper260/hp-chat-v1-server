export const classifyBulkRow = (row) => {
  const hasUserId = Boolean(String(row.user_id ?? "").trim());
  const hasTempId = Boolean(String(row.temp_login_id ?? "").trim());
  if (!hasUserId && !hasTempId) return "missing";
  if (hasUserId && hasTempId) return "conflict";
  return hasTempId ? "create" : "update";
};

export const registerTempLoginId = (seen, value) => {
  const key = String(value ?? "").trim().toLowerCase();
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
};
