---
description: Review the working-tree diff against this repo's layering and security rules
---

Review the current changes in `hp-ultra-server-v3`. Do not change code — report findings.

Gather the diff first:

```bash
git status --short && git diff
```

Check, in order:

1. **Layering.** route → controller → service → repository, one direction only.
   - No SQL outside `repositories/`.
   - No business logic in `controller/` — it parses the request, calls the service, responds.
   - No `req`/`res` inside `services/`.
2. **Auth & authorization.** Every non-public route has `auth`, and a `requireRole("<module>_<read|write>")`
   where the data is scoped. Authorization decisions read `req.user.*` (DB-backed), never raw JWT claims.
3. **Tenancy.** Every query touching a business-unit-scoped table filters on `business_unit`.
   A missing filter is a cross-tenant data leak — report it as the top finding.
4. **SQL.** Parameterized (`$1`, `$2`) only, never string interpolation. Tables schema-qualified with `v4.`.
5. **Validation.** Mutating routes go through `validate(schema)` with a Zod schema in `validators/`.
6. **Errors.** Services throw `AppError` subclasses from `errors/AppError.js`; controllers use
   `catch (err) { next(err); }`. No ad-hoc `res.status(500)`.
7. **Messages.** User-facing strings are keys through `getApiMessage()`, not hardcoded English.
8. **Secrets.** No credentials, tokens or `.env` values in the diff or in `console.log`.
9. **ESM.** Relative imports end in `.js`.
10. **API contract.** If a route path, request payload, response shape or status code changed,
    say so explicitly and list the affected `hp-chat-web` / `hp-chat-v1` service files.

Report as: blocking issues, then non-blocking suggestions, each with `file:line`.
