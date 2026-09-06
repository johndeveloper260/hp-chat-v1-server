# SOUSER implementation handoff

Updated 2026-09-06. Implementation spans all three requested repositories.
No deployment, live migration, permission mutation, account activation, email, or membership change was performed during this follow-up.
Unrelated local changes were preserved.

## Agreed behavior

- USER–COORDINATOR communication remains the core function.
- SOUSER contacts are scoped by exact sending-org code and authorised BU membership. Country is not a chat boundary.
- Officers/admins retain full bulletin visibility and management in their BU. This exception was explicitly approved by the user.
- SO User Management retains the previous separate **Read / Write** controls, scoped to the managing officer's BU. They are available on create and edit.
- Read enables bulletin access in that BU. Write implies Read and permits creation plus editing/deleting the SOUSER's own posts. Turning Read off in the UI also turns Write off; turning Write off alone retains Read.
- These switches do not change sending-org/BU audience matching. Payment/billing is not implemented.
- SOUSER-authored bulletins reach the same sending organisation's employees and permitted SOUSER readers in the post's BU, plus that BU's officers/admins.
- General officer-authored bulletins retain existing targeting behavior (including country/company targeting). SOUSER has no company profile.
- Creation uses the account's current BU and requires a writable grant for it. There is no new cross-BU composer selector. Reading and editing existing own posts use the appropriate granted BUs.

## Backend fixes

### Chat

- `POST /stream/channel/create` validates identities from PostgreSQL and creates/reuses the channel using the server SDK. Clients no longer create membership-bearing channels themselves.
- `POST /stream/channel/add-member` verifies the caller's membership and checks the proposed member against the current group. An officer cannot bridge a SOUSER into an unrelated organisation's group.
- `POST /stream/channel/remove-member` preserves existing member-removal/leave behavior through the backend, so it continues to work after direct SDK membership mutation is disabled.
- `GET /stream/contacts` replaces raw Stream user searches on web/mobile, including mobile DM search. Returns only display metadata needed by existing pickers.
- Ordinary USER contact discovery preserves company scope plus coordinator contact. Officer-managed USER-only groups can still span companies; groups containing SOUSER must respect its organisation scope.
- `POST /stream/authorize-members` remains for compatibility but is no longer relied on to secure client-side creation.
- Revocation cleanup checks **every** other member, not `some()`. Uses complete member pagination and channel time cursors, handling equal timestamps without skipping channels. Respects Stream's 30-channel page size and avoids the 1000-offset cap.
- Existing SOUSER memberships have a read-only audit / explicit apply tool: `scripts/reconcileSouserChatAccess.js`.

### Bulletin permissions

- Scope now includes readable and writable BUs separately. Empty readable scopes cannot fall back to the account's primary BU.
- Detail, attachments, comments, reactions, viewers and other per-record checks use the readable BU scope; SQL notification recipients recheck the Read/Write grant too.
- Ownership and Write permission remain required for SOUSER updates/deletes/attachment changes. Officers/admins retain moderation control.
- SOUSER management can list their own inactive/scheduled bulletins for subsequent editing. Feed readers still see published posts only.
- Separate Read/Write UI uses the existing per-BU permission endpoint. The account-wide `announcements-write` endpoint remains available but is not the preferred UI.

### Migration

`migrations/20260906_souser_scope.sql`:

1. Adds/backfills `announcement_tbl.created_by_sending_org`.
2. Snapshots and resets historical Write grants once; defaults new grants to false.
3. Aligns previously toggled SOUSER activation states with the login-enforced account flag.
4. Uses `v4.app_data_migrations` and a transaction advisory lock so subsequent runs do not reset newly enabled permissions or reapply historical activation changes.

Review the migration's activation SELECT before live execution. Read grants are not globally reset. Rollback remains documented in the SQL; it must not be used casually because removing the authorship column broadens old bulletin visibility.

Existing account management fixes from the original implementation remain: transactional DB creation/deletion, BU-scoped management, explicit activation state, Stream token revocation/deactivation, revoked-BU regrant, and side-effect warnings.

## Web client

- Scoped contacts and server-owned DM/group creation in `UserListModal`, `ChannelSettingsModal`, and `useStartDirectChat`.
- Backend removal/leave calls compatible with restrictive Stream grants.
- SO User Management Read/Write controls on create/edit; explicit activation target and delivery warnings.
- Auth refresh maps `/souser/me` database-shaped fields into the existing camelCase profile instead of replacing it. Refreshes scope on login/session restoration, focus, and every minute.
- Read-off SOUSERs are redirected from bulletin home to Chat; their home navigation item is hidden.
- SOUSER audience pickers and forbidden company/batch fetches removed from bulletin composers. Audience summary remains visible.
- Own-post edit/delete controls, live-scope permission refresh, and existing form layout preserved.

## Mobile client

- Same scoped contacts and server-created channels, including group member selection and DM list search.
- Read/Write scope refresh on session activation, foreground, and every minute.
- Bulletin Home hidden when Read/Write is off. Tasks respects `task_enabled` for both USER and SOUSER.
- SOUSER audience controls hidden; forbidden company lookups skipped; ownership comparisons normalised.
- Localised text updated across all nine locales in both clients.

## API changes and deployment compatibility

Additive endpoints:

- `POST /stream/channel/create` `{ userIds: UUID[], name?: string }` → `{ channelId }`; a name identifies a group, otherwise exactly one other member is required.
- `POST /stream/channel/remove-member` `{ channelId, userId }` → `{ success: true }`.

Existing contracts retained:

- `PATCH /souser/:id/bu-access/:bu/permissions` `{ announcements_read, announcements_write }`.
- `POST /souser/create` now accepts both permission flags; response includes optional warnings.
- `PATCH /souser/:id/toggle` accepts explicit `{ is_active }`; legacy empty-body toggle still works.
- `/souser/me.scope` adds `readable_business_units` and `announcements_read` alongside writable fields.

Older clients must be upgraded before the Stream policy is enforced. They currently create channels/search users directly. The SOUSER composers also need these client changes because company/batch lookup endpoints deny SOUSER.

## Verification completed

- Backend `npm test`: 144 passing tests, including embedded PostgreSQL (PGlite, development dependency) and behavioral Stream adapter tests.
- Actual PostgreSQL execution on isolated fixtures: migration applied twice, newly enabled Write grant preserved, feed/recipient isolation, coordinator visibility, contact queries, bulletin insert/update, BU revoke/regrant, and activation synchronization.
- Web typecheck: passes (`tsc -p tsconfig.app.json --noEmit --incremental false`).
- Mobile typecheck: 105 baseline errors, 102 after changes, **no new diagnostics**. Existing unrelated errors remain.
- Changed-file lint: web 67 baseline errors → 61, no new diagnostics; mobile 0 errors, no new diagnostics. Web's existing lint debt remains.
- Node syntax checks and Git whitespace checks pass.
- Read-only configured PostgreSQL schema inspection confirmed the relevant types, account `updated_at`, SOUSER active default (`true`), and existing Read/Write columns. No live rows/schema were changed.
- Read-only Stream checks confirmed permissions v2, accepted member ID cursor and channel created-at/cid cursor requests.

Tests do not replace a full authenticated web/mobile end-to-end run against a deployed backend. No live channel creation, account deactivation, notification delivery, or payment flow was exercised.

## Required Stream rollout policy

The configured Stream app currently permits client user search, channel creation, direct membership updates, and owner reads after membership removal. Those bypass the new backend boundary until grants are tightened.

`scripts/souserStreamPolicy.js` reads the actual permission definitions, handles custom grant IDs by action, and proposes removal of:

- SearchUser, CreateChannel, UpdateChannelMembers, JoinChannel from client grants.
- Non-membership ReadChannel grants (including owner read) so removal actually ends access.

It covers all configured chat channel types, retains messaging permissions for channel members, saves a backup before apply, and supports restore. Server SDK operations remain available.

```sh
node --env-file=.env scripts/souserStreamPolicy.js --check
node --env-file=.env scripts/souserStreamPolicy.js --apply /absolute/path/stream-policy-backup.json
node --env-file=.env scripts/souserStreamPolicy.js --restore /absolute/path/stream-policy-backup.json
```

Only `--check` was run. Audit any channel-level `config_overrides` grants and newly added channel types before activation; these can override type defaults. Direct client attempts must be tested with a SOUSER token after the rollout.

References: https://getstream.io/docs/platform/permissions/ and https://getstream.io/chat/docs/react/query-channels/

## Rollout sequence

1. Use a development environment and review migration activation/permission snapshots.
2. Apply the migration there, deploy backend and both client updates together.
3. Test Read-only, Write, neither permission, other-organisation denial, and full officer control.
4. Apply the reviewed Stream policy; test direct SDK search/create/add-member/owner-read bypass attempts fail, and normal server-mediated flows succeed.
5. Audit historical memberships, then apply cleanup:

```sh
node --env-file=.env scripts/reconcileSouserChatAccess.js
node --env-file=.env scripts/reconcileSouserChatAccess.js --apply
```

6. Test deactivation and revoked-BU access end to end. Monitor and retry any reported Stream failures.
7. Only then pilot selected SOUSER accounts and coordinate production rollout, including older mobile clients.

Billing should be a later change: subscription entitlements must be combined with these manual Read/Write permissions and existing organisation scope; payment must never grant a broader audience.
