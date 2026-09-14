# Bulk worker creation backend handoff

Shipped behind `ENFORCE_ACTIVATION=false` by default. Apply
`migrations/20260912_bulk_user_create.sql` manually before enabling the feature.

## Client contracts

- `POST /login/loginUser`: `email` accepts an email or bare temporary ID. The response user now includes `emailPending: boolean`.
- `GET /profile/bu-settings`: now also includes `emailPending: boolean`.
- `POST /login/activate/request-otp` (authenticated): `{ email }` → `204`.
- Activation errors carry a stable `code` in the body: `activation_not_required` (409), `register_email_exists` (409), `activation_rate_limited` (400), `otp_invalid` (400).
- `POST /login/activate` (authenticated): `{ email, otp, password }` → the normal login response (`token`, `streamToken`, `roles`, `user`) with `user.emailPending: false`.
- Pending authenticated accounts receive `403 { "code": "activation_required" }` when `ENFORCE_ACTIVATION=true`, except activation, account deletion, BU settings, language update, and avatar paths.
- `POST /bulk-users/import`: blank `user_id` plus `temp_login_id` creates a `USER` in the officer's BU. Upload history rows include `action`, `temp_login_id`, and `temp_password`.
- `GET /bulk-users/history/:id/export?lang=en|ja`: downloads the result CSV.
- `GET /bulk-users/template?mode=new&lang=en|ja`: downloads a header-only new-user template.
- `PATCH /profile/reset-password/:userId`: response now includes the submitted plaintext `newPassword` for coordinator handoff.

Temporary passwords in upload history are cleared after seven days whenever a new upload log is created. New accounts are not sent welcome email until activation completes.
