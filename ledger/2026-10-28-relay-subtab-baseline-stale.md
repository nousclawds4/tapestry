# B39's recorded baseline of the Relays sub-tabs' requests is stale, so B39 is red on staging; the browser spec is outside the gate, so nothing saw it

**Id:** 2026-10-28-relay-subtab-baseline-stale
**Type:** bug
**Opened:** 2026-10-28 (tagging-edges #6 Test Design; seen by its runner)
**Status:** OPEN
**Done:** —

**What was seen.**
- **What B39 checks.** `tests/brainstorm/tagging-pipeline-panel.spec.js` B39 (story 4 AC-6, T10) checks that each existing
  Relays sub-tab sends the same API requests as a recorded baseline: Router Management, Negentropy Sync, Relay
  Configuration, Streaming ETL and Scheduled Tasks. The baseline is `tests/brainstorm/fixtures/relay-subtab-requests.json`,
  last recorded 2026-09-30 (`e6f124ea`).
- **What changed.** `ffda8152` (2026-10-09, relay-stream-gaps #3, saved negentropy-sync presets) added a GET of
  `/api/strfry/negentropy-presets` to the Negentropy Sync sub-tab. B39 has been red since then, at `cb7fe4f8` and on the
  staging it merged, with or without story 6's changes. B39's body is byte-identical to `cb7fe4f8`'s.
- **Why nothing saw it.** The Playwright spec is not part of `npm test`'s gate, and relay-stream-gaps #3 ran no story-4
  browser spec.
- **What the red check hides.** B39 checks the sub-tabs in order with plain `expect` (the order at spec `:3286`, the
  checks at `:3352-3354`). So the red Negentropy Sync check ends the test, and Relay Configuration, Streaming ETL and
  Scheduled Tasks have had no request check since `ffda8152`. That includes AC-6's "nothing else in Settings changes"
  for story 6.
- **The risk for story 6** is nil: its UI diff touches only the panel. A copy of B39 with soft checks, run in story 6's
  review (round 1, 2026-10-28), showed the three hidden sub-tabs match the baseline today.

**Fix shape.**
- **Re-record the baseline** on a UI build from before story 6's panel changes land. `TP_RECORD_BASELINE=1` refuses a
  build that already contains the panel, so record from a tree that has relay-stream-gaps #3 but not story 6.
- **Or update the fixture by hand,** to add the one new GET, and note why.
- **When the baseline is re-recorded,** make B39's per-sub-tab checks `expect.soft`, so one stale sub-tab no longer
  hides the others.
- **Then** decide whether a story that changes a Relays sub-tab should run B39. A note in the spec's header, or in the
  relay sub-tab code, would do.

**Pointer:** `tests/brainstorm/tagging-pipeline-panel.spec.js` B39 (`:3319`) and the recording notes (`:186`, `:193`);
`tests/brainstorm/fixtures/relay-subtab-requests.json`; `ffda8152`.
