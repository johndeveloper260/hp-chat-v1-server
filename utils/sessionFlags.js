/**
 * Company-level feature flags a signed-in client keeps in its cached user
 * object (`company_form` gates the Forms/Leave menu, `company_ticketing` the
 * Inquiries menu, `company_flight_tracker` the Return-Home menu).
 *
 * Login computes these once; `/profile/bu-settings` recomputes them on every
 * app boot / foreground so a flag an officer flips — or a user moved into a
 * company — reaches the client without waiting for a re-login (a JWT can stay
 * valid for 30 days). Keep the key names identical to the login payload in
 * `services/loginService.js`; the clients merge this object over it.
 */
export const buildCompanyFlags = (row) => ({
  company:                row?.company      ?? null,
  company_name:           row?.company_name ?? null,
  company_ticketing:      row?.company_ticketing      ?? false,
  company_flight_tracker: row?.company_flight_tracker ?? false,
  company_form:           row?.company_form           ?? false,
});
