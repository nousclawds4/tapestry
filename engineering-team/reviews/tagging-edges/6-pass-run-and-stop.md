# Review: Story 6 — Running and stopping the pass, on the panel

**Reviewer:** Claude (acting as Reviewer)
**Date:** 2026-10-28
**Diff:** `git diff 6ffd0516..5e0e0fdd` on `feat/tagging-edges-6`. `6ffd0516` is a merge of `origin/staging` that
brought only docs. The story's commits are:
- the failing tests, `eb14b465`;
- the implementation, `ca504c42`;
- ADR 0006 Amendment 1, `ec867493`;
- the Amendment 1 tests and hardening pins, `e91c9c36`;
- the key-rule change, `5ee2ba47`;
- the evidence, `5e0e0fdd`.

**How it was reviewed.**
- **The lanes.** Read-only reviewers each took one dimension:
  - spec and tests;
  - the server against the ADR;
  - the queue and the runner against the ADR;
  - the panel;
  - security and privacy;
  - the accuracy of the docs and records.

  Another agent ran every gate on its own.
- **The verifiers.** Each finding went to a verifier who tried to refute it.
  - All 26 findings hold: 14 from the first five lanes and 12 from the docs-and-records lane.
  - The verdicts on SEC-1 and SEC-2 did not reach the writer (harness friction 1). The writer re-ran the verifier's
    probes for both (scratch `rev6/verify-security-privacy/p1.js`, `p2.js`). Both reproduce under Node 22.23.3.
  - Merging duplicates leaves 20: two blocking, 16 requested and two follow-ups.
- **The docs-and-records lane.** Its findings reached the writer cut off (harness friction 1). The orchestrating
  Reviewer folded them in before commit, from the lane's full results and verdicts. It re-read the cited lines for
  blocking 2 and requested changes 12 and 15. That lane checked the following against the code:
  - BIBLE §6, §11, §16, §24 and the Last-updated line;
  - OPERATIONS §10.1, §10.6, §12.8 and §12.9;
  - the openapi `/api/run-task` entry;
  - every ADR 0002–0005 note;
  - Amendment 1;
  - the story's Evidence and Deviations;
  - the test plan's Verification.

  The claims that hold are listed in its results. The ones that do not are blocking 2 and requested changes 12–16.
- **Where severity was decided.** Two findings were decided by the consolidating Reviewer, who re-read the lines:
  - adr-server-1: the reviewer and verifier disagreed, and the probe was re-run. It is blocking 1.
  - DR-1: the lane and its verifier both rated it blocking. It is blocking 2.

## Quality gates (run by reviewer, not trusted)

- [x] **`npm test`, run for this review on a clean tree:** `20261028T154319Z-13921-dcd1 [story6-review] started
  2026-10-28T15:43:19.168Z on 5e0e0fdd — FAIL, exit 1, 6675 passed, 36 failed, 168 skipped, 315/315 suites; failed:
  nip51-list-export-from-pins, router-stream-limit-on-connect, relationship-primitives-probe, capture-a-goal-and-see-it,
  structures-the-brain-can-trust, break-a-goal-into-pieces, attach-the-world, sessions-read-the-brain,
  teach-it-what-matters, the-brain-survives, return-the-four-on-every-read-surface,
  show-the-four-on-the-goal-screens-that-already-exist, not-yet-shared-filter, concept-count-canonical,
  summaries-element-count`.
  - **Compared with the baseline `20261028T002652Z-23104-e887`** (`cb7fe4f8`, 6460/38/170, 312 suites). I compared
    the records programmatically (scratch `rev6/writer/cmp.js`): 17 suites differ.
  - **The story's 10 suites all pass:**
    - new: `tagging-edges-pass-control` 71, `tagging-edges-pass-routes` 40, `task-queue-job-gate` 27;
    - changed: runner 77 → 87, wiring 74 → 84, state-routes 55 → 62, view 82 → 110, fetch 24 → 31,
      panel-source 28 → 38, realtime-engine 82 → 83.
  - **Seven other suites changed because the backend was restarted.** The changes do not come from the story.
    - `supervisord.log` spawned `brainstorm` at 2026-10-28 14:41:54. The process before it had run since
      2026-10-02 01:39.
    - Now pass: `information-for-agents` 55/2 → 57/0, `list-headers-me-disposition` 20/1 → 21/0,
      `list-headers-my-assistant-disposition` 49/2 → 51/0. `stamped-composite-avatar` skips 2 → 0.
    - Newly failing: `nip51-list-export-from-pins` 8/0 → 7/1 ("/api/config/public-relay must NOT be introduced"),
      `relationship-primitives-probe` 9/0 → 8/1 (H2) and `teach-it-what-matters` 26/1 → 25/2 (H6 is new; H7 fails as
      before).
  - **Why the three new failures are not this story's.**
    - Each test expects 404 for an unregistered `/api` route. The route table's default-deny (`151e39fb`, 2026-10-10)
      answers 401 to a signed-out request for such a route. The restart is the first time this host's backend has run
      that code.
    - `resolveRouteAccess('GET', …)` gives `owner` for `/api/config/public-relay`, `/api/brain/signals` and
      `/api/normalize/relationship-primitives-missing-sibling`. I checked this myself at HEAD; the gate lane checked
      `cb7fe4f8` as well.
    - The story's diff to `routeAccess.js` adds only its three exact entries (`:442-444`). It does not touch
      `auth.js` or the three test files.
    - See "Outside this story" 1.
  - **The other 12 failing suites** match the baseline: the same suites, counts and test names.
- [x] **Story suites, run singly** through `run()` on Node 22.23.3 by the lanes. Every story suite passes with the
  counts above, and so do the shared-code and route-access pins that ADR § Constraints and § Seams name.
  - **The red phase reproduces.** A `git archive` of `eb14b465` matches the test plan's Verification table exactly.
  - **Amendment 1's tests have teeth.** Run against `ca504c42`'s code, HEAD's tests fail only PX21 and PX39.
  - **The fakes' self-check:** "taggingEdgesPassFakes self-check: 19 passed, 0 failed".
- [x] **`npm run test:playwright`.** `tests/brainstorm/tagging-pipeline-panel.spec.js` was run against the UI built
  inside the container from `5e0e0fdd` (bundle `index-CHcumCZ-.js`, the one the local stack serves).
  - **Results.** Twice in the gate lane: 121 tests, 120 passed, 1 failed, 0 flaky, both times. Once more in the
    spec-tests lane, with the same result.
  - **The one failure is B39,** red before this story. It fails on the `sync` sub-tab's extra
    `GET /api/strfry/negentropy-presets`, which `ffda8152` added (ledger `2026-10-28-relay-subtab-baseline-stale`).
    B39's body is byte-identical at `cb7fe4f8` and HEAD.
  - **The sub-tabs after `sync`.** A scratch copy of B39 with soft asserts compared them too. Only `sync` differs.
- [x] **`scripts/harness-lint.sh`:** exit 0. The gate lane ran it at HEAD, and I ran it again before writing this file.
- [ ] _Lint not configured — skipped._
- [ ] _Typecheck not configured — skipped._
- [ ] _Build not configured — skipped._

## Spec adherence

- [x] **Every acceptance criterion has a passing test.** The spec-tests lane traced every AC sub-bullet to code and
  to tests whose bodies it read:
  - AC-1: CT25/26/29/30, PX2/8/18, B83–B89;
  - AC-2: CT10, CT12–CT17, CT61, RT37/38, B90–B93;
  - AC-3: CT35–CT44, CT63/64, JG26, SR68/69/83, B94–B104, B114–B116;
  - AC-4: PX3, PX13–PX23, PX33–PX37, B105–B107;
  - AC-5: CT27/49/51/52/55b/57/58b, JG17/19, PX27–PX29, PX38, TV98–TV107, B108–B111;
  - AC-6: CT63, RE70b, RT17–RT19, PS13/14/35/36, B9/B38/B112/B113.
- [ ] **No criterion is silently dropped: true of the code, not quite of the test plan.**
  - AC-6's "Follows, mutes and reports are untouched" holds by construction, but the coverage map does not name it.
    Requested change 8.
  - Blocking 1 is a narrow case where AC-3's too-late copy shows for a pass that has not ended.
- [x] **No behaviour beyond the story.**
  - Every § Deviations item stays inside an ADR decision or an AC allowance, including the optional C5-6 copy.
  - No UI string changes except those AC-6's exceptions list.
  - The new ledger row is the harness's own.
- [x] **Docs tasks and C5-1..C5-10** are done where the story assigns them. The exception is C5-6's "match ADR 0004
  T12" half, which nobody owned (requested change 7).
- [ ] **The records are not yet accurate.**
  - BIBLE §6 and OPERATIONS §12.8 misstate what `job: null` means (blocking 2).
  - § Deviations contradicts itself (requested change 1) and misstates two readings (requested changes 2 and 3).
  - § Evidence's gate account leaves out what its live suites measured (requested change 10), and three smaller
    claims need tightening (requested changes 13, 14 and 16).
  - The ledger row the ADR says this story closes is still open (requested change 12).
- [ ] **The ratified staging evidence is still owed** (§ Evidence, "Left for staging"). It comes after the merge.

## ADR adherence

- [x] **The files match ADR 0006's implementation notes:**
  - `control/{index,gate,store}.js`, `pass.js` and `jobGates.js`;
  - the run-task branch (`runTask.js:365`);
  - three route-table entries, and their registration outside the task-queue flag block (`src/api/index.js:556-564`).
- [x] **D1, D3, D4 and D6–D20 hold on a line-by-line walk.**
  - Every Redis call is bounded.
  - No chain step waits on another.
  - Every state-changing step bumps the generation.
  - No stale snapshot is served after an answer.
  - Every key that reaches a mark, the record or a signal comes from the snapshot, never the body (Amendment 1 § A).
  - The departures are the ones § Deviations and Amendment 1 § C record, except D5's read order (requested change 4).
- [ ] **D2 does not hold for one class of id.** `jobIdOf` treats any key that starts with `reconcileTaggingEdges@` as
  legacy (blocking 1). That also makes Amendment 1's Consequences sentence "What a Stop can now name" false for those
  ids.
- [x] **The shared queue code changes only by opt-in** (§ Constraints).
  - Every other task's worker callback is byte-identical to the base.
  - So are `enqueueTask`, `computeJobId` and `runViaQueueAsync`.
  - The semaphore only gains guarded additions.
  - The processor's one change is the env value, which has one narrow corner (requested change 6).
- [x] **D10 holds.** It covers the handlers' lifetime, `stopNow`, exit 0, no `TASK_ERROR`, `JOB_ID_RE` behind a
  `typeof` guard, and `job` as the pessimistic record's last member.
- [x] **No new dependencies.** `package.json` is not in the diff.

## Concept-graph integrity

- [x] **No concept or schema change,** so no firmware reinstall is needed. The diff touches nothing under `firmware/`
  or `setup/`. No added line in `src/` or `ui/` builds a `39998:` handle or names a TA pubkey. The story's "Concepts
  touched" handle is the ADR 0015 named exception, in prose only.
- [x] **Orientation via `/summaries`:** not applicable, because no new code reads concepts.

## Things tests can't catch

- [x] **No secrets in committed files.** A grep of the added lines finds no key material.
  - **The record.** `record.json` on the local stack holds only 8-character who keys.
  - **The console log.** The backend log names the owner's key only in lines older than this story.
- [x] **No leftover debug logging.** The diff's `src/` and `ui/` add no `console.*`, TODO or `debugger`.
- [x] **No commented-out code.**
- [ ] **Error paths and edge cases: three gaps, all reachable only through a BullBoard add.**
  - A Stop silently fails for one id prefix (blocking 1).
  - An out-of-range scheduled-id time makes every snapshot throw (requested change 5).
  - A NUL in any task's job id now fails its spawn (requested change 6).
- [x] **Concurrency.**
  - **The chain.** One serialised promise chain holds every start, stop and gate step, so a waiting job cannot cross
    into running during a Stop.
  - **The snapshot.** It runs outside the chain and reads the in-memory marks last, at classification (requested
    change 4 records that).
  - **The lease.** No path the ADR names leaks the heavy-task lease. One theoretical hook-throw path is follow-up 1.
- [x] **Security.**
  - **Who may act.** The three routes sit behind `requireOwnerOrAdmin`, plus the handler's re-check (`ownerOrAdmin`:
    401, then the role 403, then the cross-site 403). The run-task delegate applies `sameHost` to direct local calls
    too.
  - **Stop's keys.** Each key is only compared, never used as a path, a Redis argument, a shell argument or a regex.
  - **Record entries** are own properties (CT68).
  - **The signal** takes its pid only from `report.json`. The pid must be an integer > 0, and the process start time
    must match, which guards against a reused pid.
  - **Who** reaches no signed-out reader (PX38). The local stack's signed-out reads confirm this.

## House rules check

- [x] **Concept Graph API authority respected** (not touched).
- [x] **No new lint, typecheck or build tooling.**
- [x] **TA pubkey:** no new literal, and no new runtime lookup is needed.

## Product-guide adherence

- [ ] _Not applicable: the book's anchor is an acceptance frame with no PRD (`audits/tagging-edges/book.md`)._

## Findings

### Blocking

1. **`src/pipeline/tagging-edges/control/index.js:67-68`: `jobIdOf` is a prefix test, used at `:560`, `:574` and
   `:621`.** (adr-server-1. The reviewer rated it non-blocking and the verifier blocking. I re-ran the probe and
   decided blocking.)
   - **The problem.**
     - `keyOf` (`:62-65`) keys a job added another way (R3) with the id `reconcileTaggingEdges@x` by its own id,
       correctly.
     - But `jobIdOf` maps every key that starts with `reconcileTaggingEdges@` to `reconcileTaggingEdges`.
     - So `signal` compares the report's `job.id` (`reconcileTaggingEdges@x`: `processor.js:139` passes it, and
       `JOB_ID_RE` admits `@`) against the wrong id.
   - **What a Stop of that running pass does.**
     - It answers 200 `{stopped: [{key, how: 'too-late'}], recorded: true}`, sends no signal, and marks the item
       stop-asked.
     - The pass keeps running, up to its 30-minute time-out.
     - Every later Stop answers `nothing-to-stop`.
     - The panel shows the stop as too late for a pass that has not ended, which AC-3 reserves for a pass that ended
       another way.
     - A starting pass with that id gets `pass-not-reachable` instead.
     - The stop entry records the wrong `jobId` (`:621`).
   - **Reproduced.** Scratch `rev6/adr-server/probe-legacy-prefix.js`, re-run for this review: the prefixed id gives
     `too-late` and 0 kills, while `job-ordinary-1` gives `asked-to-stop` and 1 kill.
   - **Why it blocks.**
     - It is drift from D2, which allows one exception: the key of a job whose id is exactly `reconcileTaggingEdges`.
     - It makes this story's own Amendment 1 Consequences sentence (ADR `:1499-1500`) false.
     - The owner widened Stop's key rule this very day so that BullBoard-added jobs can be stopped.
     - R9 (c)'s accepted residual answers honestly ("nothing changed. Press Stop again"). This one answers a false
       success and then refuses every later Stop.
     - The fix is small.
   - **Asked change.**
     - **For the Implementer.** In `waitForRun`, `signal` and the stop entry, compare the report's `job.id` with the
       snapshot item's own `jobId` (each act already carries it as `a.jobId`), not with `jobIdOf(a.key)`. Keep the
       `run:` rule as it is.
     - **For the Tester.** Add a pass-control case with a running and a starting pass whose id is
       `reconcileTaggingEdges@x`. The running one must answer `asked-to-stop` with one SIGTERM; the starting one must
       be signalled once its first record names it. The case must fail on HEAD.
     - **For the Architect.** Add a dated note at D2, and correct the Consequences sentence. Then name the case D2's
       key scheme cannot tell apart under R7 or R9: a BullBoard id `reconcileTaggingEdges@<digits>` has the same key as
       a legacy job with that timestamp. Making `jobIdOf` match only `@<digits>` would leave that collision, which is
       why the item's `jobId` is the better fix.
2. **`BIBLE.md:321` (§6) and `OPERATIONS.md:751` (§12.8): what `job: null` means** (DR-1, from the docs-and-records
   lane; its verifier rated it blocking, and the consolidating Reviewer re-read both lines and the code).
   - **The problem.**
     - BIBLE says "Each report carries `job`, `{ id }` of the task-queue job that ran it, or null (a report from before
       story 6)".
     - OPERATIONS says "it is null in a report from before story 6, or for a run with no job id".
     - But a report from before story 6 has no `job` member at all. ADR 0006 D10 says so ("A report from before
       story 6 has no `job`"), and `computeStatus` passes `previous[]` through unchanged.
     - `job: null` is written by a story-6 pass whose `BRAINSTORM_TASK_JOB_ID` is unset or fails D10's pattern
       (`reconcileTaggingEdges.js:68`, `:156`). That is a run outside the task queue, or a queue-dashboard id such as
       `manual run`.
     - The tests already tell the two cases apart (fixtures `:31`; TV99; CT15 rule 3).
     - A read-only GET of the local status shows the story-6 runs with `job`, and the three 2026-09-28 runs with no
       `job` member.
   - **Why it blocks.** These are the public status's reference docs. A client that follows them reads `job === null`
     as "an old report". It then misclassifies post-story-6 runs and misses old reports, which have `job === undefined`.
   - **Asked change (the Implementer).**
     - **BIBLE `:321`.** Say: "or null when the pass ran with no job id that D10's pattern accepts (a run outside the
       task queue, or a queue-dashboard id such as `manual run`); a report from before story 6 has no `job`."
     - **OPERATIONS `:751`.** Make the matching change: null for a run with no job id, or one outside D10's pattern;
       absent from a report written before story 6.

### Requested in this round (non-blocking: accuracy fixes, asked now while the story goes back)

1. **`engineering-team/stories/tagging-edges/6-pass-run-and-stop.md:586` (ST-1, UI-1, DR-3).**
   - **The problem.** "It closes by itself when the busy list read is empty, whether or not the queue state is known."
     contradicts `:623-624` in the same list. `:586` was never true of any committed code:
     `TaggingPipelinePanel.jsx:201` requires `busy.known` at `ca504c42` and at HEAD. Amendment 1 § C (ADR `:1463-1469`)
     supersedes it, but the bullet carries no mark.
   - **Asked change.** Strike `:586`, or add a dated note pointing at `:623` and Amendment 1 § C.
2. **Story `:576-577`, "Tones" (UI-2, DR-5).**
   - **The problem.** "the refusals and unknown are `warn` … the failures are `bad`" is wrong for three outcomes that
     the ACs call refusals. `PASS_ACTION_TONE` (`ui/src/utils/taggingPipelineView.js:714-715`) gives `refused`
     (401/403), `queue-unavailable` and `record-unavailable` the tone `bad`. Only the 409 refusals are `warn`. The code
     follows story 5's precedent, so the record is what is wrong.
   - **Asked change.** The 409 refusals and unknown are `warn`; nothing-to-stop is `neutral`; 401/403,
     queue-unavailable, record-unavailable and failed are `bad`.
3. **Story `:538-540`, "When the status's snapshot fails" (adr-server-2, DR-4).**
   - **The problem.** `controlOf` (`src/api/tagging-edges/index.js:201-208`) gives `read-failed` for a rejection, or
     for `null` or `undefined`. For a string, number, boolean or `{}`, the probe gives `control: {}`. The real
     controller always resolves an object.
   - **Asked change.** Say "rejects, or answers null or undefined". Or have `controlOf` check `isObject(s)` and
     `Array.isArray(s.items)`, so the sentence holds as written.
4. **`src/pipeline/tagging-edges/control/index.js:338-339` against D5's read order (adr-server-3).**
   - **The problem.** `compute()` reads the in-memory marks at classification, after the queue reads. D5 lists "2. the
     in-memory state" before them. The order is sound: each later read sees fresher state, and CT11 still pins the I/O
     order. But only a code comment records it.
   - **Asked change.** One § Deviations bullet, or a dated note at D5. No code change.
5. **`src/pipeline/tagging-edges/control/index.js:55`, `toIso` (SEC-1; I verified it myself because the verifier's
   verdict did not arrive).**
   - **The problem.** `toIso` checks only `Number.isFinite`, not whether the time fits a JavaScript Date.
     - A busy job whose scheduled-shaped id ends in digits past Date's range (`repeat:sched:99999999999999999`, which
       BullMQ accepts), or whose `timestamp` is past it, makes `iso()` throw at `:434`.
     - So every snapshot rejects. The public status says it cannot tell what is waiting, and Run, Stop and the confirm
       route all answer 500, a Stop of the owner's own running pass included.
     - At pickup, `beforeAcquire` throws through `recordStart` (`:300`), and the job fails.
     - Re-run: scratch `rev6/verify-security-privacy/p1.js`.
     - Only an owner or admin can add such a job, through BullBoard (R3).
   - **Asked change.** Make `toIso` return null for an invalid Date, so neither `compute` nor `recordStart` throws, and
     add a pass-control case. Or name the case as R9 (d), with its way out: remove the job in BullBoard.
6. **`src/manage/taskQueue/queue/processor.js:139`, `BRAINSTORM_TASK_JOB_ID: String(job.id)` (SEC-2; verified as for
   item 5).**
   - **The problem.** Node refuses an env value that contains NUL (`ERR_INVALID_ARG_VALUE`), and the executor turns
     that into a rejection. Amendment 1 records that BullMQ accepts such ids. So a BullBoard-added job of any task whose
     id carries NUL now fails at launch, where before this story it ran. D10's "harmless elsewhere" and § Constraints'
     "leave every other task's behaviour unchanged" do not hold in this corner. Re-run: scratch
     `rev6/verify-security-privacy/p2.js`.
   - **Asked change.** Set the variable only when the id has no NUL; the pass then records `job: null`, as for any id
     outside D10's pattern. Or add one sentence to D10 naming the corner.
7. **`ui/src/utils/taggingPipelineView.js:220`, against ADR 0004 T12 (`0004-tagging-pipeline-panel.md:832-836`)
   (UI-3).**
   - **The problem.** C5-6 was taken: the `no-status` copy now names "a fault in the driver itself". But T12's note
     still says the driver's code-less errors come only from its own checks, and that the fault lies "in a library
     other than the driver". The ask's "match ADR 0004 T12" half belonged to no one (story `:334` gives C5-6 to the
     Implementer as copy only). PC55's title (`test/tagging-pipeline-codes.test.js:931`) carries the old wording too.
   - **Asked change.**
     - **The Architect.** A dated note on T12 naming a fault in the driver itself.
     - **The Tester.** Reword PC55's title.
     - **The test plan.** Change the row "AC-6, C5-6's copy, if taken | none drafted" (`:84`) to say it was taken.
8. **`engineering-team/stories/tagging-edges/6-pass-run-and-stop.test-plan.md:76-85`, the AC-6 rows (ST-4).**
   - **The problem.** The coverage map never names AC-6's "Follows, mutes and reports are untouched". It holds by
     construction: no graph module in `control/*.js`, `pass.js` or `jobGates.js`, and the runner diff touches no graph
     write. Story 5's plan mapped the same clause (to SR14 and SR47).
   - **Asked change.** Add the clause with its basis: by construction, plus the runner suite. Optionally, add a source
     pin like SR47.
9. **Test plan `:261` (ST-3, DR-11).**
   - **The problem.** It calls `ledger/2026-10-28-relay-subtab-baseline-stale.md` "untracked", but `eb14b465`
     committed it.
   - **Asked change.** Drop the word.
10. **Story § Evidence, "The gate" (`:431-458`) (gate lane, DR-7, DR-8; re-checked for this review).**
    - **The stale backend.** All three cited runs started before the 14:41:54Z restart: `e887` at 00:26Z, `46dd` at
      05:29Z and `0e14` at 14:28Z. Their live suites measured the backend process started on 2026-10-02, not this
      story's server code. "No other suite changed" is true of those records, but the section does not say what they
      measured.
    - **"They are this host's live-stack set" (`:455`).** `router-stream-limit-on-connect` fails because macOS's `sed`
      differs from Linux's (ledger `2026-10-09-router-patch-sed-macos`), not because of the live stack.
    - **"Twice" (`:456`).** Only one stored 121-test log exists (`impl6c/tester/pw-full.log`). This review's two runs
      reproduce the result.
    - **The baseline row.** The baseline record says dirty (1); the dirty file is the worktree's untracked
      `node_modules`.
    - **Asked change.**
      - Say the three runs ran against the 2026-10-02 backend.
      - Quote this review's run `20261028T154319Z-13921-dcd1`, on the restarted backend, with its 7 differences and
        why each is outside the story.
      - Name the `sed` suite.
      - Cite the runs that were twice, or say once.
      - Say what made the baseline dirty, as story 5's review asked (its requested change 13).
11. **`ledger/2026-10-28-relay-subtab-baseline-stale.md`, this story's own row (ST-2).**
    - **The problem.** B39 checks the sub-tabs in order with plain `expect` (spec `:3286`, `:3352-3354`). The red
      `sync` check therefore ends the test, so Relay Configuration, Streaming ETL and Scheduled Tasks have had no
      request check since `ffda8152`, AC-6's "nothing else in Settings changes" included. The row does not say so.
      Its pointer "B39 (`:2216`)" also predates this story; B39 is at `:3319`.
    - **The risk for story 6.** Nil: its UI diff touches only the panel. The gate lane's soft-assert copy shows the
      three hidden sub-tabs match the baseline today.
    - **Asked change.** Add that sentence and the line, and suggest `expect.soft` when the baseline is re-recorded.
12. **`ledger/2026-09-28-confirm-route-joins-finishing-job.md:6-7` (DR-2).**
    - **The problem.** The row still reads `**Status:** OPEN`, `**Done:** —` at `5e0e0fdd`. ADR 0006 says this story
      closes it (`:283-284`, `:320`, `:628`), and the story's Out of scope says the same. BIBLE §16 already tells readers
      the defect is gone. The code supports closing it: the confirm route lines up under its own job id through
      `d.lineUp` (`src/api/tagging-edges/index.js:344-355`).
    - **Asked change.** Flip the row on this branch: Status DONE, Done with the date and story 6. Say that story 7
      re-checks it from the panel. If the row is meant to flip at the ship instead, say so in the story.
13. **Story § Evidence `:481`, "exactly one SIGTERM pending (`ShdPnd` bit 15)" (DR-6).**
    - **The problem.** `ShdPnd` is a bitmask, and standard signals do not queue. It shows that SIGTERM is pending, not
      how many were sent. "Bit 15" is right only when bits are counted from 1 (mask `0x4000`).
    - **Asked change.** Say "SIGTERM pending (`ShdPnd`, signal 15)". Rest "one SIGTERM" on the controller, which calls
      `kill` once per running target (`control/index.js:570-585`), and on its pinning tests.
14. **Story § Evidence `:496-497`, the console log's lines that name the owner's key (DR-9).**
    - **The problem.** The list names the config reader's `Found BRAINSTORM_OWNER_PUBKEY` and the sign-in route only.
      It leaves out two more sources:
      - the config reader's `Found BRAINSTORM_ADMIN_PUBKEYS=` lines (the local admin list holds the owner's key);
      - the profile-metadata lines (`src/api/export/profiles/queries/kind0.js:84`, `:169`).

      The substance holds: the story's diff adds no `console.*` call.
    - **Asked change.** Name those sources, or say "only in lines written by code older than this story (the config
      reader, sign-in, profile metadata)".
15. **`OPERATIONS.md:731`, "no route or log names it" (DR-10).**
    - **The problem.** The same paragraph has just described `GET /api/tagging-edges/pass/record`, which names who for
      the owner or an admin.
    - **Asked change.** Say "no other route, and no log, names it".
16. **Story § Evidence `:445`, "Each changed suite" (DR-12).**
    - **The problem.** The list names only the suites whose counts changed. `tagging-pipeline-codes` (54) and
      `tagging-edges-switch-record` (47) were edited too, with unchanged counts. The test plan's table does record both
      edits.
    - **Asked change.** Say "each suite whose counts changed", and optionally name the two.

### Non-blocking (follow-ups, not asked in this round)

1. **`src/manage/taskQueue/queue/resourceSemaphore.js:140` (ADRQ-NB1).**
   - **The problem.** A `shouldAbandon` that throws just after a winning attempt rejects `acquire` with the lease
     still set, so the heavy-task lock is held for its 4 h TTL. The verifier reproduced this with an in-memory fake.
   - **Why it is a follow-up.** Today's only hook (`gate.js:39-41`, a Set lookup) cannot throw.
   - **The fix, when made.** Catch the throw and HDEL the won lease, or state in the JSDoc (`:98-104`) that the hook
     must be synchronous and must not throw.
2. **`ui/src/utils/taggingPipelineView.js:651` (UI-4).**
   - **The problem.** `known` is `control.queue === 'ok'` alone, so `{queue: 'ok'}` with no `busy` array reads as
     known and empty. That would close an open Stop prompt.
   - **Why it is a follow-up.** `controlOf` always passes an array, and the code matches Amendment 1 § C's definition.
   - **The fix, when made.** Optionally, require `Array.isArray(control.busy)`.

### Outside this story (for the owner to place)

1. **Three live tests still expect 404 for unregistered `/api` routes,** which the default-deny has answered 401
   since `151e39fb`:
   - `test/nip51-list-export-from-pins.test.js:194-205`;
   - `test/relationship-primitives-probe.test.js:314` (H2);
   - `test/teach-it-what-matters.test.js:761` (H6).

   No ledger row covers them. ADR 0006 § Seams "Live and evidence" notes the 404-to-401 change. A row is needed.
2. **Pre-existing weaknesses seen by the lanes,** described generically and already tracked privately:
   - the shared cross-site check compares hostnames only;
   - large request bodies are parsed before the access check;
   - the heavy lease's best-effort release on a Redis error can hold the lock up to its TTL.

   None was introduced here.

### Harness friction

1. **The consolidating Reviewer's input was cut short.** The docs-and-records lane's findings, and the verifiers'
   verdicts on SEC-1 and SEC-2, did not reach the writer, though both verifiers left scratch files. The workflow
   truncated the combined lane results at a fixed length.
   - **What happened next.** The orchestrating Reviewer read the docs lane's 12 findings and their verdicts in full
     from the run's results, before this file was committed. It re-read the cited lines for blocking 2 and requested
     changes 12 and 15, and folded all 12 in:
     - DR-1 as blocking 2;
     - DR-2, DR-6, DR-9, DR-10 and DR-12 as requested changes 12–16;
     - DR-3, DR-4, DR-5, DR-7, DR-8 and DR-11 as duplicates, marked on items 1, 2, 3, 9 and 10.
   - **What should change.** A workflow should hand each lane's result over whole, or stop when it cannot.
2. **The test plan's browser recipe (`:259`) builds into the repo's `tmp/tp-dist`,** which a read-only reviewer may
   not write. A host build also fails: `ui/node_modules` has only the `rollup-linux-*` natives. The lanes built with
   `vite --outDir` into the container's `/tmp`, then used `docker cp` to scratch. The recipe could give that form.
3. **The macOS host has no `timeout` binary.** A suite loop wrapped in it silently yields "no result" for every suite.
   Recipes that loop over suites should say so.
4. **The gate record drops a failing test's name.** `nip51-list-export-from-pins` is recorded as FAIL 7/1 with
   `failures: []`, so the name has to be read from the log.
5. **A gate run does not record which backend its live suites measured.** All three of the Implementer's runs measured
   a process 26 days older than the tree. This is a sibling of `2026-09-20-live-tier-fails-on-stale-stack` (a stack
   serving another branch). The record could carry the backend's start time, or warn when it predates the commit.
6. **A follow-up story 5's review routed to "story 6" was never carried.** Review 5's round-1 non-blocking 1 (return
   focus when the prompt closes; `5-real-time-path-switch.md:207-211`) said "otherwise goes to story 6". Story 6's
   Planning took only round 2's C5-1..C5-10, and the new Stop prompt repeats the gap (`PassControls.jsx:45-47` moves
   focus to Cancel on open and returns it nowhere). A review's "goes to story N" has no surface that the next Planning
   reads.
7. **The role and phase files tell the Reviewer to commit the review** (and to flip the story's Status on a passing
   verdict). In this workflow every lane, this writer included, is read-only for git, and the orchestrator commits.
   The lanes flagged the conflict. The files could name the parallel-lane variant.
8. **`tagging-pipeline-fetch` and `tagging-pipeline-codes` return `skipped: undefined` from `run()`,** not 0. It is
   harmless, but the RESULT lines read inconsistently.
9. **zsh reads `$c:src/...` in `git show $c:src/...` as the `:s` history modifier.** It answered "ambiguous argument
   6ffd0516outeAccess.js". Use `"${c}:path"`. This is the same class as the known `"${VAR}:tag"` trap, and is worth
   one line in the reviewer guidance (docs-and-records lane).
10. **Playwright runs leave no durable per-run record.** Each run overwrites `test-results/results.json`, and
    `.last-run.json` is not reliably refreshed. So a story's browser-evidence line cannot be re-derived after the fact
    (requested change 10's "twice"). The gate has run records and the browser lane has none. A run-id'd record for
    `test:playwright`, like `tmp/gate-runs`, would close this (docs-and-records lane).

## Verdict

**CHANGES_REQUESTED**

The implementation matches the story and ADR 0006, Amendment 1 included, closely. Every story suite passes. Against
the baseline, the full gate shows no change that this story caused. The browser spec fails only B39, which was red
before this story.

Two things block:
- **Blocking 1.** For a BullBoard-added id that starts `reconcileTaggingEdges@`, a Stop reports success and too late,
  never signals the pass, and then refuses every later Stop. This drifts from D2 and makes Amendment 1's own
  Consequences sentence false. The fix is small.
- **Blocking 2.** BIBLE §6 and OPERATIONS §12.8 say `job: null` marks a report from before story 6. In fact such a
  report has no `job`, and null marks a story-6 run with no usable job id. These are the public status's reference
  docs.

Requested changes 1–16 are record and accuracy fixes, asked in the same round. Back to `/implement-feature`:
- **the Implementer:**
  - blocking 1's code and blocking 2's two sentences;
  - requested changes 1–6, 10–16 (in 4, a note at D5 instead of the bullet would be the Architect's);
- **the Tester:** blocking 1's case, PC55's title in 7, and 8 and 9;
- **the Architect:** blocking 1's D2 note and Consequences fix, and the T12 note in 7.

The ratified staging evidence must exist before staging is promoted to main.
