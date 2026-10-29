# The browser lane's recipe builds into the repo, and its runs leave no record that a later reader can quote

**Id:** 2026-10-28-browser-lane-recipe-and-run-record
**Type:** meta
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 2 and 10)
**Status:** OPEN
**Done:** —

Two gaps in the same lane: how a browser run is built, and what it leaves behind. One small harness story could close
both.

**1. The recipe writes into the repo.**
- **Where it is written.** The tagging panel's recipe builds the UI inside the container with
  `vite build --outDir ../tmp/tp-dist`, which lands in the checkout's gitignored `tmp/tp-dist`. It is given in the
  spec header (`tests/brainstorm/tagging-pipeline-panel.spec.js:189-196`) and in the test plans of tagging-edges
  stories 4 (`:188-201`), 5 (`:231`) and 6 (§ Test infrastructure, "The browser lane"; § How to run).
- **Why it bites.** A read-only reviewer lane may not write there. A host build is no way out either: `ui/node_modules`
  holds only the `rollup-linux-*` natives (OPEN.md rows 71 and 253 cover that hazard).
- **What the lanes did.** They built with `vite --outDir` into the container's `/tmp`, then used `docker cp` to copy the
  build to their scratch.
- **The run writes there too.** The documented run passes no `--output`, so Playwright 1.56.1 empties the checkout's
  `test-results/` when it starts ("clear output", `node_modules/playwright/lib/runner/tasks.js:196-206`), then writes
  it and `playwright-report/` again. Story 6's review, round 2, cleared `test-results/` that way. Its run added
  `--reporter=line`, so it wrote back only `.last-run.json` and one failure's folder, and left `playwright-report/` as
  it was. The removed `results.json`, `junit.xml` and `.last-run.json` are the files part 2's ten-hour gap was read
  from; copies are in that review's scratch. *(Added at story 6's review, round 2, 2026-10-28.)*

**2. A run leaves no durable record.**
- **What is kept.** `playwright.config.js:25` writes the JSON report to `test-results/results.json`, which each run
  overwrites. `.last-run.json` goes into the run's output folder (`node_modules/playwright/lib/runner/lastRun.js:42`),
  and a `--list` run writes none (`:64`) and clears nothing (`node_modules/playwright/lib/runner/testRunner.js:371-374`),
  while the config's reporters still write the repo's `results.json`, `junit.xml` and `playwright-report/`. That is
  why, on 2026-10-28 on this machine, `test-results/.last-run.json` (05:25:54Z, a full run's) was ten hours older than
  `results.json` (15:44:40Z, a `--list` run's: 121 tests, none run, the output folder the repo's `test-results/`). A
  run with `--output <scratch>` and the config's json reporter would leave the same gap. *(Corrected at story 6's
  review, round 2, 2026-10-28: this first said `.last-run.json` "is not reliably refreshed", then that an `--output`
  run caused the gap.)*
- **What that costs.** A story's browser-evidence line cannot be re-derived after the fact. Story 6's Evidence said its
  browser run had that result "twice". Only one stored log exists, a lane's scratch copy, so the review asked for the
  runs to be cited or the word changed to "once" (requested change 10).
- **The contrast.** The Node gate has run records (`tmp/gate-runs/<run-id>.json`, read with `npm run gate:status`). The
  browser lane has none.

**Fix shape.**
- **Give the recipe a scratch form:** build into the container's `/tmp`, copy out with `docker cp`, serve from
  outside the repo, and run with `--output <scratch>` and with `PLAYWRIGHT_JSON_OUTPUT_FILE`,
  `PLAYWRIGHT_JUNIT_OUTPUT_FILE` and `PLAYWRIGHT_HTML_OUTPUT_DIR` set to scratch paths. `--output` moves only the
  artifacts and `.last-run.json`; the config's three reporters (`playwright.config.js:23-27`) take those variables
  before the config (`node_modules/playwright/lib/reporters/base.js:543-545`, `reporters/html.js:150`). The spec header
  is the one place to write it; the test plans can point there.
- **Give `test:playwright` a run-id'd record** like the gate's: commit, bundle, spec, counts and failing test names, one
  file per run. Then a review quotes a run id, as it does for `npm test`.

**Related.** OPEN.md row 114 (the browser class is in no gate); ledger `2026-09-28-live-and-evidence-runs-unrecorded`
(evidence runs need a record before Review); ledger `2026-10-09-light-gate-b-no-gate-status` (a browser-only Gate B
has nothing to quote).

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 2 and 10.
