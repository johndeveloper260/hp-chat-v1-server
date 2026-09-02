---
description: Pre-ship gate — syntax check, tests, and a summary of the diff
---

Run the full gate for `hp-ultra-server-v3`, then summarize. Do not commit and do not push.

**1. Syntax check the changed files.** This repo has no ESLint config and no lint script;
`node --check` is the real static check available:

```bash
git diff --name-only --diff-filter=ACM -- '*.js' | xargs -I{} node --check {}
```

**2. Typecheck:** not applicable — this repo is plain JavaScript with no TypeScript
and no build step. Skip this step and say so.

**3. Tests:**

```bash
npm test
```

**4. Summarize the diff:**

```bash
git status --short && git diff --stat && git diff
```

Report:

- Pass/fail for each step above, with the real output. If a step fails, stop and report
  it — do not paper over it.
- What changed and why, grouped by domain (a change usually spans
  `routes/` + `controller/` + `services/` + `repositories/` + `validators/` for one domain).
- **API contract impact.** State plainly whether any endpoint path, request payload,
  response shape, status code or error body changed. If yes, list the exact client call
  sites that must be updated:
  - `hp-chat-web` → `src/features/<domain>/services/<domain>Service.ts`
  - `hp-chat-v1` → `src/features/<domain>/services/<domain>Service.ts`

  and note that each client is a **separate session in its own repo**.
- Anything that needs a manual step before deploy: a new required env var (add it to
  `config/env.js` and to the Heroku config), a new `.sql` file in `migrations/` (applied
  by hand — there is no migration runner), or a new CORS origin in `server.js`.
