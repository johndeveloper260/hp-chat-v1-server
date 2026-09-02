---
description: Scaffold a new endpoint (route + controller + service + repository + validator + test) and list the client call sites to update
---

Scaffold a new endpoint in `hp-ultra-server-v3`. Target: **$ARGUMENTS**
(e.g. `POST /issue-type/create`, or `add a GET /leave/summary endpoint`).

If the method, path or payload is ambiguous, ask once before writing files.

## 1. Read before writing

Pick the closest existing domain and read all five of its files as the template —
`routes/issueTypeRoutes.js` and its controller/service/repository/validator are a clean,
complete example of the house style:

```bash
ls routes controller services repositories validators
```

Determine the domain name (`foo`), the HTTP method, the path, the required role
(`<module>_read` / `<module>_write` — see `middleware/requireRole.js`), and the payload.

## 2. Write or extend, in this order

Reuse the existing domain files if the domain already exists; only create new files for
a genuinely new domain. Keep the strict one-way flow **route → controller → service → repository**.

1. **`validators/fooValidator.js`** — Zod schema, exported as `createFooSchema` /
   `updateFooSchema`. Query/param schemas are validated with `validate(schema, "query")`.
2. **`repositories/fooRepository.js`** — all SQL. `getPool().query(text, params)`,
   parameterized (`$1`, `$2`) only, tables schema-qualified with `v4.`, and every
   BU-scoped query filtered on `business_unit`.
3. **`services/fooService.js`** — business logic, no `req`/`res`. Throws `NotFoundError`
   / `ConflictError` / `ValidationError` from `errors/AppError.js`.
4. **`controller/fooController.js`** — `export const doFoo = async (req, res, next) => {
   try { ... } catch (err) { next(err); } }`. Reads identity from `req.user`
   (`req.user.id`, `req.user.business_unit`), never from the raw token. Success messages
   go through `getApiMessage(key, lang(req))`.
5. **`routes/fooRoutes.js`** — `router.<method>("/path", auth, requireRole("foo_write"), validate(createFooSchema), doFoo)`.
6. **`server.js`** — if the domain is new, add the `import` and the `app.use("/foo", fooRoutes)`
   with the other mounts, **above** the `app.use(errorHandler)` line, which must stay last.
   Do not move the `app.use("/stream", stream)` mount — it is deliberately before `express.json()`.
7. **`utils/notificationTranslations.js`** — add any new message keys for all 8 languages
   (en, ja, id, vi, my, km, bn, th).

## 3. Test

Add `test/fooValidator.test.js` using `node:test` + `node:assert/strict`, following
`test/returnHomeValidator.test.js`. Cover the schema: valid payload accepted, missing
required field rejected, and any status/enum restriction enforced. There is no DB fixture
harness — test the validator and pure helpers, not a live query.

```bash
npm test
git diff --name-only --diff-filter=ACM -- '*.js' | xargs -I{} node --check {}
```

## 4. List the client call sites to update

**This is required output, not optional.** The backend defines the API shape; both clients
must be updated to match, and each is a **separate session in its own repo** — do not edit
them from here.

Print the new contract exactly once:

- Method + full path (including the `server.js` mount prefix)
- Auth headers required (`Authorization: Bearer <token>` and `x-app-identity` — both clients send both)
- Required role
- Request payload (from the Zod schema)
- Success response body + status code
- Error bodies (`{ error, error_code }` from `middleware/errorHandler.js`)

Then locate the real call sites rather than guessing — run these and report actual hits:

```bash
grep -rn "/foo" ../hp-chat-web/src/features --include=*.ts --include=*.tsx
grep -rn "/foo" ../hp-chat-v1/src/features --include=*.ts --include=*.tsx
```

And name the files to change:

- **hp-chat-web** — `src/features/<domain>/services/<domain>Service.ts`
  (add the method calling the shared axios instance `src/shared/services/apiClient.ts`),
  plus `src/features/<domain>/types/<domain>.ts` if the payload or response type changed.
- **hp-chat-v1** — `src/features/<domain>/services/<domain>Service.ts`
  (calling `src/services/apiClient.ts`).

If the domain does not yet exist in a client, say so and give the folder to create,
matching that repo's existing feature structure.

Close with a one-line handoff for each client repo that can be pasted into a new session.
