export const TEMP_LOGIN_DOMAIN = "temp.hp.local";
export const TEMP_LOGIN_ID_RE = /^[a-z0-9][a-z0-9._-]{2,49}$/i;

export const normalizeLoginId = (value) => {
  const login = String(value ?? "").trim().toLowerCase();
  return login.includes("@") ? login : `${login}@${TEMP_LOGIN_DOMAIN}`;
};

export const isTempLogin = (email) =>
  String(email ?? "").toLowerCase().endsWith(`@${TEMP_LOGIN_DOMAIN}`);
