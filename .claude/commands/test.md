---
description: Run the Node test suite and triage failures
---

Run this repo's tests:

```bash
npm test
```

That is `node --test` — Node's built-in runner over `test/*.test.js`, using
`node:test` and `node:assert/strict`. There is no Jest, Mocha or Vitest here.

To run a single file:

```bash
node --test test/returnHomeValidator.test.js
```

Then:

- If everything passes, report the pass count and stop.
- If something fails, read the failing assertion, open the file under test, and explain
  the actual cause before proposing a fix. Do not edit the test to make it pass unless the
  test itself encodes the wrong expectation — say so explicitly if you conclude that.
- If `$ARGUMENTS` names a file or area, scope the run to it.

**Writing new tests:** tests here cover pure units — validators, `utils/`, error mapping.
There is no database fixture harness, so do not write a test that needs a live Postgres
connection. Test the Zod schema or the pure helper instead. Follow the shape of
`test/returnHomeValidator.test.js`: import the unit, `test("...", () => { assert... })`.
