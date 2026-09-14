export const isActivationAllowedPath = (path) => [
  "/login/activate", "/login/deleteAccount", "/profile/bu-settings",
  "/profile/update-language", "/profile/avatar",
].some((prefix) => path.startsWith(prefix));

export const isActivationOtpValid = (record, otp, now = new Date()) =>
  Boolean(record?.otp_code === otp && record.otp_expiry && new Date(record.otp_expiry) >= now);
