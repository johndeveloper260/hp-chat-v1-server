# hp-ultra-server-v3

Node backend for HoRenSo Plus. **Source of truth for the API** consumed by
`hp-chat-web` (React/Vite) and `hp-chat-v1` (React Native / Expo).

## Stack

- **Node 22** (`node@^22.15.0` pinned as a dependency), ESM only — `"type": "module"`,
  every import needs the `.js` extension.
- **Express 5** (`server.js` is the single entry point).
- **PostgreSQL** via `pg` `Pool` (`config/db.js`). All tables live in the **`v4` schema**
  (`v4.user_account_tbl`, `v4.issue_tbl`, …) — always schema-qualify SQL.
- **Auth**: JWT (`jsonwebtoken`) signed with `SECRET_TOKEN`, 30-day expiry with a
  7-day sliding refresh window (`middleware/slidingExpiration.js`, which returns a
  new token in the `X-Refresh-Token` response header).
- **Validation**: Zod v4 schemas in `validators/`, applied via `middleware/validate.js`.
- **Realtime/chat/video**: Stream (`stream-chat`, `getstream`, `@stream-io/node-sdk`),
  plus `socket.io`.
- **Storage**: AWS S3 + CloudFront signed URLs. **Email**: nodemailer + handlebars templates.
- **Deploy**: Heroku. Remotes — `heroku` → dev app, `heroku-actual-prod` → prod app,
  `origin` → GitHub.

There is **no TypeScript** and **no build step** in this repo.

## Commands

Only these three scripts exist in `package.json`:

```bash
npm start        # node server.js
npm run dev      # nodemon server.js
npm test         # node --test  (Node's built-in runner, files under test/)
```

**There is no lint script and no ESLint/Prettier config in this repo.** Do not invent one.
The only real static check available is Node's syntax check on a single file:

```bash
node --check path/to/file.js
```

That is what the PostToolUse hook in `.claude/settings.json` runs after each edit.

## Layout

Requests flow strictly one direction: **route → controller → service → repository**.

| Folder | Role |
|---|---|
| `routes/` | `express.Router()`, mounts middleware, no logic. One file per domain. |
| `controller/` | Parse request → call service → send response. **No SQL, no business logic.** Errors go to `next(err)`. |
| `services/` | Business logic. No `req`/`res`. Throws `AppError` subclasses. |
| `repositories/` | All SQL, via `getPool().query(text, params)`. Parameterized queries only. |
| `validators/` | Zod schemas, one per domain, named `createXSchema` / `updateXSchema`. |
| `middleware/` | `auth.js`, `requireRole.js`, `validate.js`, `slidingExpiration.js`, `errorHandler.js`. |
| `config/` | `db.js`, `env.js` (validates env at startup), `getPool.js`, `ioSocket.js`, `systemMailer.js`. |
| `errors/AppError.js` | `NotFoundError`, `ConflictError`, `ValidationError`, … |
| `utils/`, `jobs/`, `migrations/`, `scripts/`, `test/` | Helpers, cron jobs, raw `.sql` migrations, one-off scripts, tests. |

Naming is consistent per domain: `routes/fooRoutes.js`, `controller/fooController.js`,
`services/fooService.js`, `repositories/fooRepository.js`, `validators/fooValidator.js`.

## Conventions

- Route wiring: `router.post("/create", auth, requireRole("visa_write"), validate(createSchema), createFoo)`.
- `requireRole("<module>_<read|write>")` — ADMIN always passes; `_write` satisfies `_read`.
- Never trust JWT claims for authorization/filtering. `middleware/auth.js` re-reads
  identity (`business_unit`, `user_type`, roles) from Postgres on every request because
  a token can be up to 30 days stale after a company transfer. Use `req.user.*`.
- User-facing messages are keys resolved through `utils/notificationTranslations.js`
  (`getApiMessage(key, lang)`), for 8 languages: en, ja, id, vi, my, km, bn, th.
- Tests are plain `node:test` + `node:assert/strict` files in `test/`, named `*.test.js`.
  They test pure units (validators, helpers) — there is no DB fixture harness.

## Gotchas

- **Never commit `.env`.** It is gitignored and holds `SECRET_TOKEN`, DB credentials,
  AWS keys and Stream secrets. Never print its contents into a session.
- `app.use("/stream", stream)` is mounted **before** `express.json()` on purpose — the
  Stream webhook needs the raw body for HMAC verification. Do not reorder `server.js`.
- `errorHandler` must stay mounted **last**, after every route.
- `config/env.js` throws at startup if a required variable is missing — the server
  refuses to boot rather than run with a missing secret.
- CORS uses an explicit whitelist in `server.js`. A new client origin must be added
  there or requests fail with "Not allowed by CORS".
- `migrations/` holds raw `.sql` files applied manually; there is no migration runner.

## Cross-repo contract

**This repo defines the API shape.** `hp-chat-web` and `hp-chat-v1` are consumers —
neither one gets to change a contract, they only follow it.

When you add, rename or remove an endpoint, change a route path, or change a request
or response payload (including status codes and error bodies), that is a **breaking
change for both clients**. In that case:

1. Land the change here first, with a matching test in `test/`.
2. **Flag it explicitly in your summary**, naming the endpoint, the old and new shape,
   and the client files that need updating.
3. The client updates are **separate sessions, one per repo** — do not edit
   `hp-chat-web` or `hp-chat-v1` from a session running in this repo.

Client call sites always land in the same two places:

- `hp-chat-web` → `src/features/<domain>/services/<domain>Service.ts` (26 service files,
  all calling the shared axios instance `src/shared/services/apiClient.ts`).
- `hp-chat-v1` → `src/features/<domain>/services/<domain>Service.ts` (18 service files,
  all calling `src/services/apiClient.ts`).

Both clients send the JWT as **both** `Authorization: Bearer <token>` and `x-app-identity`,
and both read the refreshed token from the `X-Refresh-Token` response header — keep both
header paths working. Use `/endpoint` to scaffold a new endpoint and list the exact call
sites to update.
