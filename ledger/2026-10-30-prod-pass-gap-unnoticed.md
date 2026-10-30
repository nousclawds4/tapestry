# Production's daily tagging pass did not run from 16 to 23 October 2026, and nothing showed it

**Id:** 2026-10-30-prod-pass-gap-unnoticed
**Type:** bug (an unexplained outage of the backstop, and no signal that it stopped)
**Opened:** 2026-10-30 (tagging-edges: the roll-up of what is left, after story 6 reached production)
**Status:** OPEN
**Done:** —

**What was seen.** Production's public `GET /api/tagging-edges/status` was read at 2026-10-30T00:41Z. It holds the
latest pass and the nine before it. All times are UTC.
- **Daily passes ran up to 2026-10-15,** each starting at about 14:24Z. The last was 14:24:40Z to 14:25:04Z on 10-15,
  and it read "the graph agrees with the relay".
- **Nothing ran from 10-16 to 10-22,** so seven daily passes are missing.
- **On 10-23 at 20:52:57Z, off the daily time, one pass was refused.** It records `reasonCode` `schema`, the failure
  `{stage: 'schema', code: 'ServiceUnavailable', message: 'the Neo4j server could not be reached'}`, 560 ms, and 0
  taggings read.
- **Daily passes have run again from 10-24 at 14:24:38Z.** Each reads "the graph agrees with the relay", so the gap
  left nothing wrong in the graph.
- **The real-time path on production** reads `counts.failedReads.catchUp` 10, with `lastError`
  `{at: '2026-10-15T15:38:54.596Z', stage: 'catch-up', code: 'timeout'}`. Today it is `live`, and its recent
  catch-ups are `done`.

**Likely cause (unverified).** Production was down or degraded from about 10-15 15:38Z until it was brought back on
10-23. The refused pass at 20:52Z shows the stack running that day before Neo4j answered. The bundle production then
served until 2026-10-29 was built at 22:19Z that day (its `Last-Modified`), when no deploy workflow ran in either
repo. The period overlaps the move off the old GitHub account (suspended 10-19) to `nousclawds4/tapestry` (10-23).
No record in the repo names an outage, and this machine has no SSH to the droplet.

The off-time pass on 10-23 fits "one overdue fire runs when the process returns", a sighting for OPEN.md row
`2026-09-30-missed-fire-policy-unverified`. Whether the process started at that moment was not checked.

**Why it matters.** The pass is the backstop for what the real-time path cannot reflect: a wipe, an expiry, or a
version revoked in the same batch (ADR `tagging-edges/0003` A1). It did not run for eight days, and nothing said so.
- The panel shows the latest pass's start and end times, but nothing in its code marks a pass as overdue. The only
  `stale` warning in `ui/src/utils/taggingPipelineView.js` is about the path's own status.
- No alert exists.
- Related: OPEN.md row `2026-09-27-scheduled-tasks-failure-never-set`, under which the Scheduled Tasks history marks
  every finished run a success.

**Fix shape.**
1. If the droplet's logs still cover 10-15 to 10-23, read them (owner, over SSH), and record the cause here.
2. Decide whether the panel should flag a pass that is overdue, for example the latest pass older than its schedule's
   interval plus a margin. That is a small feature for the tagging-edges panel (story 7 or later), or a general
   Scheduled Tasks check.
3. Record the off-time pass's reading on the missed-fire row once that row is settled.

**Pointer:** production's `GET /api/tagging-edges/status` (`latest` and `previous`) and
`GET /api/tagging-edges/realtime/status`; `engineering-team/stories/tagging-edges/6-pass-run-and-stop.md` § Evidence,
"Production".
