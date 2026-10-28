# A failing suite that returns counts only is recorded with `failures: []`, so the gate record cannot say which test failed

**Id:** 2026-10-28-suite-results-omit-names-and-skips
**Type:** meta
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 4 and 8)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The case.** In run `20261028T154319Z-13921-dcd1`, `nip51-list-export-from-pins` is recorded as 7 passed, 1 failed,
  with `failures: []`. Its `run()` returns `{ pass, fail }` and no names
  (`test/nip51-list-export-from-pins.test.js:211-231`), so the failing test's name had to be read from the log.
- **Why the record looks clean.** `clipFailures` turns a missing array into `[]` (`test/helpers/gateRecord.js:98-99`).
  So "this suite gave no names" and "this suite had no failures" are written the same way.
- **How common it is.** On 2026-10-28, 102 of the 314 suite files read never mention `failures` (a text search over
  `test/registry.js`'s files). Any of them that fails is recorded the same way.
- **The harmless half.** `tagging-pipeline-fetch` and `tagging-pipeline-codes` return `{ pass, fail, failures }` with no
  `skipped` (`test/tagging-pipeline-fetch.test.js:776`, `test/tagging-pipeline-codes.test.js:967`). The gate reads a
  missing `skipped` as 0 (`test/helpers/gateRunner.js:57-63`), so the gate is right. But a suite's `RESULT` line, run
  singly through `run()`, prints no `skipped` for these two, and reads unlike the others.

**Fix shape.**
- **Keep "no names" distinct in the record:** `failures: null` (or a flag) when a failing suite returned none, and
  `npm run gate:status` says "names not reported; read the log".
- **State the `run()` result once,** `{ pass, fail, skipped, failures }`, in `engineering-team/README.md` § "Running and
  reading the test gate". Suites gain the missing fields when they are next touched. A suite that fails but gives no
  names could be flagged by the gate as a warning.
- Gate-engine follow-ups also gather in OPEN.md row 291; this one is not among them.

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 4 and 8;
`test/helpers/gateRecord.js`; `test/helpers/gateRunner.js` (`normalize`).
