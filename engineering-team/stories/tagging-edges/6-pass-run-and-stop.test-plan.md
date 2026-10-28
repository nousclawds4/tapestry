# Test Plan: Story 6 — Running and stopping the pass, on the panel

**Story:** `engineering-team/stories/tagging-edges/6-pass-run-and-stop.md`
**ADR:** `engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md`
**Date:** 2026-10-28

## The suites

| Suite | Story 6's tests | Level |
|---|---|---|
| `test/tagging-edges-pass-control.test.js` (new) | CT1–CT64, with CT8b, CT55b and CT58b | component: one `createController(deps)` instance over the shared fakes. CT2 runs in a child process; CT57 uses the real store on a temp dir |
| `test/task-queue-job-gate.test.js` (new) | JG0–JG26 (JG0: the shared fakes' self-check) | module (JG1–JG4); queue integration (JG5–JG8: the real semaphore over a fake Redis; JG9–JG13: the real `initTaskQueue` over `require.cache` stand-ins); component (JG14–JG26) |
| `test/tagging-edges-pass-routes.test.js` (new) | PX1–PX38, with PX6b | handler with injected deps (PX1–PX31); child process (PX32: `pass.js`'s real defaults; PX33–PX37: the real `authMiddleware` in front of the real `handleRunTask`) |
| `test/tagging-edges-wiring.test.js` | SWR75–SWR84 | source pin (SWR75, SWR77); module (SWR76); child process (SWR78–SWR84) |
| `test/tagging-edges-state-routes.test.js` | RT17, RT18, RT19 (revised); RT32–RT38 | handler |
| `test/tagging-edges-runner.test.js` | SR1, SR50, SR68, SR69 (revised); SR78–SR87 | unit over injected ports; SR82 runs in a child process |
| `test/tagging-pipeline-codes.test.js` | PC1, PC3, PC42 (revised titles); PC54's floors (`codeValues`, `codeValueLiterals`) | source pin |
| `test/tagging-pipeline-view.test.js` | TV83–TV108 | unit, pure and clock-free |
| `test/tagging-pipeline-fetch.test.js` | TF25–TF31 | unit, with an injected `fetchImpl` |
| `test/tagging-pipeline-panel-source.test.js` | PS13, PS14, PS28 (revised); PS29–PS36 | source pin |
| `tests/brainstorm/tagging-pipeline-panel.spec.js` | B9, B10, B38 (revised); B83–B115 | browser (Playwright on the rebuilt UI, every `/api` route mocked) |
| `test/tagging-edges-switch-record.test.js` | the header comment and SR34's in-test comment (C5-2) | comments only |
| `test/tagging-edges-realtime-engine.test.js` | RE70b (a pass that ended `stopped` still gets its catch-up); `test/helpers/taggingEdgesRealtimeFakes.js`'s `w.passEnd` gains defaults equal to today's values | component |

Two suites use the prefix `SR`. Below, "SR" means the runner suite, and the switch-record suite is named wherever one of its tests is meant. The three new suites are in `test/registry.js`, after `tagging-edges-drift-route.test.js`.

## Coverage map

### Acceptance criteria

| Criterion | Test ids | Test file | Level |
|---|---|---|---|
| AC-1, what it shows: owner and admins see "Run a pass now" once the status has a body, in the empty and the ready branch; pressing it asks nothing | B83, B89; PS29, PS32, PS36; TF25 | spec; panel-source; fetch | browser; source pin; unit |
| AC-1, nothing busy: the server lines up a pass, and within 10 s every viewer sees it | CT25, CT7, CT8; PX2, PX13, PX14; B83, B90 | pass-control; pass-routes; spec | component; handler; browser |
| AC-1, busy: refused plainly with nothing lined up, for a pass waiting (with no report yet), behind scoring, starting, running, a due scheduled run waiting, and a running pass with a stop asked | CT26, CT4, CT24; PX8, PX9, PX16; TV87; B84 | pass-control; pass-routes; view; spec | component; handler; unit; browser |
| AC-1, more than one pass busy: the panel shows each | CT22, CT26 (a due run behind a running pass, both listed); RT37; B85 | pass-control; state-routes; spec | component; handler; browser |
| AC-1, just after a pass ends: a new pass is lined up, and the answer is never "lined up" when none will run | CT29, CT18, CT8; JG24; PX18 | pass-control; job-gate; pass-routes | component; handler |
| AC-1, task queue unavailable: refused plainly, nothing started | CT30, CT6; PX6, PX7, PX17, PX35; TV87; B106 | pass-control; pass-routes; view; spec | component; handler; child process; unit; browser |
| AC-1, while a Run is under way: disabled and says so; after 15 s with no answer, enabled again with "outcome unknown", then the next read | B86, B87; TV88; TF28, TF30, TF31; PS28, PS30 | spec; view; fetch; panel-source | browser; unit; source pin |
| AC-1, the pending-confirmation line beside Run | B88; PS32 | spec; panel-source | browser; source pin |
| AC-2, per busy pass: waiting or running, and since when (a scheduled run since its id's millis; any pass since it was asked for) | CT10, CT15, CT16, CT17, CT18, CT19; CT58; RT37; TV85; B90 | pass-control; state-routes; view; spec | component; handler; unit; browser |
| AC-2, what a waiting pass waits behind: a pass ahead, or other heavy work | CT16, CT17, CT23; JG20; TV85; B85, B90 | pass-control; job-gate; view; spec | component; unit; browser |
| AC-2, a stop asked for, and since when | CT21, CT37; CT58; TV85; B91 | pass-control; view; spec | component; unit; browser |
| AC-2, every viewer sees the same, and a reload keeps it | CT58 (signed out = owner); TV108; B90, B91 | pass-control; view; spec | component; unit; browser |
| AC-2, the server cannot tell whether a pass is waiting: viewers are told so, never "nothing waiting" | CT12, CT13, CT14, CT62; RT38; PX7; TV84, TV86; B92 | pass-control; state-routes; pass-routes; view; spec | component; handler; unit; browser |
| AC-2, a waiting pass gives up after 4 h: no longer waiting, said to have given up, no report, its start kept in the history | CT61; JG11, JG25, JG26; B93 | pass-control; job-gate; spec | component; queue integration; browser |
| AC-2, the public status may say waiting or stop asked, and when, but never who | CT58; RT37 | pass-control; state-routes | component; handler |
| AC-3, what it shows: Stop while some busy pass has no stop asked; never for the backstop's not-yet-due run | TV86; CT16; B91, B94 | view; pass-control; spec | unit; component; browser |
| AC-3, what it acts on: every open pass at confirm time; an out-of-date prompt is refused and changes nothing; the panel shows the new state | CT38, CT24, CT39; JG22, JG23; PX24; TV91; B101 | pass-control; job-gate; pass-routes; view; spec | component; handler; unit; browser |
| AC-3, the prompt: one block per pass (a waiting pass, a running pass, two busy); the panel's own inline prompt | TV93, TV94, TV95; PS33; B94, B95, B96 | view; panel-source; spec | unit; source pin; browser |
| AC-3, the confirmation warning ("taken up" or "cannot tell"), and the "stays pending" line | CT59, CT60; TV96, TV97; B97 | pass-control; view; spec | component; unit; browser |
| AC-3, Cancel sends nothing | B98, B94 | spec | browser |
| AC-3, while a stop is under way; after 15 s with no answer, the prompt closes with "outcome unknown" | B99, B100; TV92; TF26, TF28, TF30 | spec; view; fetch | browser; unit |
| AC-3, a waiting pass stopped: it never begins running, is gone within 10 s, and leaves no report, with the confirmation still pending | CT35, CT36; JG5, JG6, JG7, JG10, JG21, JG26; PX22, PX25; B99 | pass-control; job-gate; pass-routes; spec | component; queue integration; handler; browser |
| AC-3, a running pass stopped: "stop asked" until it ends; then its own outcome "stopped on request by <who> at <time>"; what it wrote stands; stopped before its claim, the confirmation stays pending; after its claim, the confirmation is used up | CT37, CT41, CT45, CT46; PX23; SR50, SR68, SR69, SR78, SR83, SR85; TV83, TV101; B91, B102 | pass-control; pass-routes; runner; view; spec | component; handler; unit; browser |
| AC-3, a stop that comes too late (finished, refused at its start checks, pid reused, ESRCH) | CT42, CT44; TV90, TV104; B104 | pass-control; view; spec | component; unit; browser |
| AC-3, no force-stop: one SIGTERM to the pass's own pid, never a group or another signal, and still listed until it ends | CT37, CT43; B91, B102 | pass-control; spec | component; browser |
| AC-3, nothing to stop, a second stop, and a pass that lines up after a stop (not covered by it) | CT39, CT40; PX24; TV91; B107 | pass-control; pass-routes; view; spec | component; handler; unit; browser |
| AC-3, the schedule: a stop changes no schedule entry; a scheduled run taken out of line skips one run, and its next run keeps its slot | CT36, CT63 | pass-control | component |
| AC-4, Run and Stop only from a signed-in owner or admin; signed out, a stranger and another site are refused, changing and recording nothing | PX3, PX4, PX20; PX33 | pass-routes | handler; child process |
| AC-4, the run-task route for this pass: owner and admin allowed; signed out and stranger refused (the middleware); another site refused; a local call allowed and recorded as local; refused while busy and just after a pass ends, as Run is; a refusal records nothing | PX13–PX19, PX33–PX36; SWR77 | pass-routes; wiring | handler; child process; source pin |
| AC-4, the Task Explorer shows the refusal (`message`) | PX15, PX16, PX17, PX34, PX35 | pass-routes | handler; child process |
| AC-4, other tasks on the route are unchanged | PX37; SWR77; JG13 | pass-routes; wiring; job-gate | child process; source pin; queue integration |
| AC-4, either may act on the other's pass, including one applying the confirmation | CT50; PX22, PX23 | pass-control; pass-routes | component; handler |
| AC-4, refused or failed: the panel shows the reason, with the state unchanged | TV88, TV89, TV92; TF27, TF29; B105, B106, B107 | view; fetch; spec | unit; browser |
| AC-5, each kind of who: owner or admin (shortened key), schedule, confirmation, local, other | CT25, CT32, CT51; JG17, JG19; PX2, PX13, PX14, PX29, PX34; RT17; SWR84 | pass-control; job-gate; pass-routes; state-routes; wiring | component; handler; child process |
| AC-5, the first run that adding or enabling a Scheduled Tasks entry starts, recorded as the schedule | JG17. That first run reaches story 6's code only as a job with the `repeat:sched:<entryId>:<millis>` id form, which the gate records as the schedule; no separate case drives the scheduler itself | job-gate | component |
| AC-5, only what happened is recorded: a request that lines up no new pass records no start | CT26, CT31; PX8, PX16, PX19; RT32, RT33 | pass-control; pass-routes; state-routes | component; handler |
| AC-5, when an action cannot be recorded: a Run is refused; a Stop takes effect and says it was not recorded; a start that cannot be refused goes ahead unrecorded; the history before it survives | CT27, CT28, CT34, CT49, CT55, CT56; JG18, JG25; PX10, PX11, PX17, PX25; RT35; TV90; B106, B110 | pass-control; job-gate; pass-routes; state-routes; view; spec | component; handler; unit; browser |
| AC-5, the panel shows who started each pass, and who asked it to stop | TV98–TV106; B85, B102, B103, B108 | view; spec | unit; browser |
| AC-5, the last 10 actions, newest first | CT52; PX28, PX29; B109 | pass-control; pass-routes; spec | component; handler; browser |
| AC-5, a pass from before story 6; no action recorded (the empty state) | TV99; SR81; PX28; B108, B109 | view; runner; pass-routes; spec | unit; handler; browser |
| AC-5, the record lasts across restarts | CT57; CT20, CT21, CT61 (a fresh controller reads the record); JG15, JG17 | pass-control; job-gate | component |
| AC-5, only a signed-in owner or admin may read who | PX27, PX28, PX32; CT58; RT37; TV107; B111 | pass-routes; pass-control; state-routes; view; spec | handler; child process; component; unit; browser |
| AC-5, no who from any route, the task system's public views included: after an owner's and an admin's Run and Stop, a signed-out read of the status, the held list and the Task Explorer's run data, plus the structured events and console output (D11 "Who is never logged") | PX38; CT58, CT58b (the four kinds of start indistinguishable on the public status; closed D12 member sets); RT37 | pass-routes (child process); pass-control; state-routes | child process; component; handler |
| AC-6, Run and Stop change no schedule entry | CT63, CT36 | pass-control | component |
| AC-6, Run and Stop leave the real-time path's switch, the Scheduled Tasks entries and the job schedulers alone; the pass catches up after a stopped pass | CT63 (the queue's full surface wrapped, so any remove or scheduler call is seen; `realtime/switch.json`, `switch-history.json` and `scheduled-tasks.json` byte-for-byte unchanged after Run, three kinds of Stop and a refused Stop); CT36; RE70b | pass-control; realtime-engine | component |
| AC-6, the pass behaves as story 2 defines; a stopped pass leaves its writes | SR50, SR81, SR83, SR85, SR86; the runner suite's existing SR2–SR77 | runner | unit |
| AC-6, with the path on, it catches up after any pass ends, a stopped one included | RE70b. The engine asks for its catch-up when a watched run's process is no longer alive (`realtime/index.js:995-998`), whatever the outcome; RE70b pins that for `stopped` | realtime-engine | component |
| AC-6, the confirm route and its console snippet work as before | RT17, RT18, RT19, RT32–RT36; SWR84; CT31–CT34 | state-routes; wiring; pass-control | handler; child process; component |
| AC-6, the panel's reads still change nothing; only this story's requests are sent | PS13, PS14, PS28; TF31; B38; TF1 (unchanged) | panel-source; fetch; spec | source pin; unit; browser |
| AC-6, the opening line; the pass section's line on how a pass starts | PS35, B112; PS36, B9 | panel-source; spec | source pin; browser |
| AC-6, the copy C5-4 changes (the panel change, D20) | PS34; B113 | panel-source; spec | source pin; browser |
| AC-6, C5-6's copy, if taken | none drafted (optional; the Implementer's) | — | — |
| AC-6, Confirm points at story 7 | B10 (its message); PS14 (its message); PS31 | spec; panel-source | browser; source pin |

**Added by the test review** (these rows complete the table above):

| Criterion | Test ids | Test file | Level |
|---|---|---|---|
| AC-1, the queue-off refusal is the handler's, answered while another step holds the chain | PX6b | pass-routes | handler |
| AC-3, a stop that comes too late for a pass killed by its time-out (the pessimistic record): the stop shown with who and "ended first", never "stopped on request" | TV104; B104 | view; spec | unit; browser |
| AC-3, the open prompt never rewrites its text from later polls; it closes by itself on nothing busy only while not pending | B114; B115 | spec | browser |
| AC-3, a Stop naming the backstop's not-yet-due run: nothing to stop, nothing recorded, the run still goes ahead at its time | CT64 | pass-control | component |
| AC-3, a waiting pass taken out of line leaves a pending confirmation pending, and the report unchanged | CT35 | pass-control | component |
| AC-5, a schedule's start whose record write failed goes ahead and reads "not recorded" (`startRecorded: false`) | CT55b | pass-control | component |
| D2, the default `randomKey` gives a whole `LINEUP_ID` that BullMQ accepts, distinct per start | CT8b | pass-control | component |

### ADR 0006, by decision group

| Decision | Test ids | Test file | Level |
|---|---|---|---|
| **Controller** D1: the module, one instance, the chain, refusals outside the chain | CT1–CT6; JG14, JG23; SWR81 | pass-control; job-gate; wiring | component; child process |
| D2: an id per start, `LINEUP_ID` accepted by BullMQ, the legacy key, the id's millis, `jobIdOf` | CT7–CT10, CT45 | pass-control | component |
| D5: the busy snapshot (read order, one shared deadline, the four queue states, the liveness key rules, every classification branch, `stopAskedAt`, sort order, moves between reads, the status-only cache) | CT11–CT24; JG20, JG24 | pass-control; job-gate | component |
| D6: Run in the controller (the record first, busy, record unavailable, a failed add, the finishing window, the queue off) | CT25–CT30 | pass-control | component |
| D8: the confirm route's start (join, line up, queue not ready, a failed add, cannot be refused) | CT31–CT34; RT17, RT18, RT19, RT32–RT36; SWR84 | pass-control; state-routes; wiring | component; handler; child process |
| D9: Stop (waiting, scheduled, running, stale prompt, nothing to stop, pid wait, the signal check, legacy, `run:` targets, restart, queue down, unrecordable, either role) | CT35–CT50 | pass-control | component |
| D11: the record (shape, history, pruning, read error, damaged file, real store with 0700/0600 modes) | CT51–CT57; JG17, JG18, JG25; PX28 | pass-control; job-gate; pass-routes | component; handler |
| D11: "Who is never logged" | PX38 (structured events recorded through a stand-in, console captured) | pass-routes | child process |
| D12: the status's `control` member (no who, ISO times, `startRecorded`, the confirmation verdict and its read order, `gaveUp`, a failed read served as such) | CT58–CT62; RT37, RT38 | pass-control; state-routes | component; handler |
| **Gate** D3: `gateFor` opt-in, loading the controller lazily | JG1, JG2; SWR82 | job-gate; wiring | module; child process |
| D3: the worker callback (go path, every skip path, give-up, `ended` always, other tasks unchanged) | JG9–JG13, JG26; SWR79 | job-gate; wiring | queue integration; component; child process |
| D3: the gate's methods (skip marks from the record and from memory, the schedule's and "another way"'s starts, phases, the waiting→running boundary, chain steps, `ended`, `gaveUp`) | JG14–JG25 | job-gate | component |
| D2: `queueHealth()` | JG3, JG4; SWR79 | job-gate; wiring | module; child process |
| D4: the semaphore's `shouldAbandon` (before an attempt, while waiting, after a win, unchanged without it) | JG5–JG8 | job-gate | queue integration |
| R1, R2, R3, R7 | CT28 (R1); CT49, JG16 (R2); JG19 (R3); CT9, CT45, JG15, JG19, TV100, TV102 (R7) | pass-control; job-gate; view | component; unit |
| **Routes**: `pass.js`'s exports, and its one `defaultDeps` with `getAdminPubkeys` (the SWR74 trap) | PX1, PX31, PX32; SWR83 | pass-routes; wiring | handler; source pin; child process |
| D6: the Run handler (checks in order, 415/400, queue off, read failure, busy, two at once, unrecordable, failed add, never rejects) | PX2–PX12 | pass-routes | handler |
| D7: the run-task delegate, and the branch through the real middleware | PX13–PX19; PX33–PX37; SWR77 | pass-routes; wiring | handler; child process; source pin |
| D9: the Stop handler (refused callers, body rules, either role, codes, unrecordable, never rejects) | PX20–PX26 | pass-routes | handler |
| D13: the gated record read | PX27–PX29; SWR75, SWR76 | pass-routes; wiring | handler; source pin; module |
| D14: answers and codes (fixed codes as written, allow-listed `cause`, no full pubkey) | PX30, PX12, PX26; CT27 | pass-routes; pass-control | handler; component |
| **Runner** D10: handler lifetime (registered after the lock checks; removed last in `finish()`; removed on a first-save failure; during `finish()`; never at top level) | SR78, SR79, SR80, SR86, SR87 | runner | unit |
| D10: `stopNow()` finishes `stopped` (all five safe points; rewrites unchanged); `exitCodeFor('stopped')` is 0 | SR50, SR68, SR69, SR83, SR85; SR84 | runner | unit |
| D10: the `job` port, `BRAINSTORM_TASK_JOB_ID`, and the processor's spawn environment | SR1, SR81, SR82; SWR78 | runner; wiring | unit; child process |
| D10: the codes guard's floors | PC1, PC3, PC42, PC54. PC18 and PC19 turn red once `stopped` and `requested` are extracted, until they have sentences | codes | source pin |
| **Wiring and registration** | SWR75 (mounts behind `requireOwnerOrAdmin`); SWR76 (`ROUTE_ACCESS`, `resolveRouteAccess` owner for both POSTs and for GET and HEAD of the record; status still public); SWR77 (`return await` branch); SWR78 (spawn env); SWR79 (`queueHealth`, `jobGates` required by `initTaskQueue`); SWR80–SWR82 (load-time pins); SWR83, SWR84 (defaults). The sweep suites (`admin-action-sweep` AC6a, T2, T4, `admin-action-sweep-access`) cover the new entries unchanged; the entries are the Implementer's, in the same commit as the routes | wiring; `test/registry.js` | source pin; module; child process |
| **Panel** D15: `sendRun`, `sendStop` (same race, never reject, 15 s default, the one private `raced`) | TF25–TF31; PS13, PS28 | fetch; panel-source | unit; source pin |
| D16: `busyView` / `runOutcome` / `stopOutcome` / `stopPromptView` / `passWho`; the stopped outcome's copy; clock-free | TV84–TV86 / TV87–TV89 / TV90–TV92 / TV93–TV97 / TV98–TV107; TV83; TV108 | view | unit |
| D17: the controls (PassControls placement, state in the panel, labels, inline prompt, no `/confirm/i` button, outcomes, record failure) | PS29–PS33; B83, B86, B89, B94, B99, B100, B111 | panel-source; spec | source pin; browser |
| D18: who per pass, and the history | TV98–TV104; B93, B102, B103, B104, B108, B109 | view; spec | unit; browser |
| D19: copy (opening line, empty state; style pins PS16–PS24 unchanged) | PS35, PS36; B9, B112 | panel-source; spec | source pin; browser |
| D20: C5-4 (`schedPending={schedule.state === 'loading'}`) | PS34; B113 | panel-source; spec | source pin; browser |
| **§ Seams "New cases the review named"** | listed one by one under Edge cases | — | — |

### Carry-forwards (the Tester's)

| Item | Where | Level |
|---|---|---|
| C5-1: `stack-free-npm-test` skips G2 on host Node 16.17.0, because G2's probe calls the global `fetch`; its 7 / 0 is Node 22.23.3's | `engineering-team/stories/tagging-edges/5-real-time-path-switch.test-plan.md` (Verification, review round 1: the note and the table row) | doc |
| C5-2: `gate-result-record` C9 refuses one spelling (`? 200 : 500`), in the files it scans; SR34's literal per-row statuses are what keep SR34 from deriving its status | the same plan (two dated notes); the header comment of `test/tagging-edges-switch-record.test.js` and SR34's in-test comment | doc; test comment |
| C5-3: PC55's exemption is wider than the plan said (the regex at `test/tagging-pipeline-codes.test.js:930` at `442c9dec`): what it exempts, what it does not read, and why "Every Neo4jError …" passes | the same plan ("Readings taken in this round") | doc |
| C5-4: the panel change chosen by the Architect (D20) | PS34, B113 | source pin; browser |

### Revised pins (revised, not deleted)

| Test | What changed | Red phase |
|---|---|---|
| SR1 | title and check gain the twelfth port, `job` | fails |
| SR50, SR68, SR69 | now expect `stopped`, `reasonCode: 'requested'`, `failure: null`, exit 0. Each keeps its claim and batch proofs; SR69 still proves the claim is spent | fail |
| PC1 | `passOutcome` floor 4 → 5 | fails until the runner finishes `stopped` |
| PC3; PC42; PC54 | `failureStage` 9 → 8; `failureCodeRunnerLiterals` 9 → 8, with `signal` dropped from PC42's named list (it stays in `T12_NAMED` for PC45); `codeValues` 20 → 19 and `codeValueLiterals` 11 → 10 (PC54's title unchanged) | pass now |
| RT17 | `queueHealth` is consulted before `lineUp`; `lineUp` is called with mode `confirm` and who `{kind: 'confirmation'}`; `jobId` is the spy's key | fails |
| RT18 | with `queueHealth` `'not-ready'` or `'off'`: zero `lineUp` calls, and no `isQueueAvailable` ping | fails |
| RT19 | zero `lineUp` calls in the withdraw race | passes now |
| PS13 | exactly the POSTs inside `sendSwitch`, `sendRun` and `sendStop` | fails |
| PS14 | `READ_PATHS` gains `/api/tagging-edges/pass/record`; the two POST paths are allowed; its message names story 7 | fails |
| PS28 | names the three senders | fails |
| B9; B10; B38 | the empty-state line names Run; the no-confirm message names story 7 (title unchanged); the allowed reads gain the pass record (at least 6 reads a minute), still no non-GET for a viewer who never presses | B9 and B38 fail; B10 passes |
| TF1 | unchanged: every read sends GET | passes |

Pins that pass now, by design: JG0 (the fakes' self-check), JG8, JG13, PX37, RT19, SR87, PC3, PC42, PC54, RE70b, B10, and B58 (title only). Each pins behaviour story 6 must keep, or a floor that holds before and after.

## Edge cases

- [x] Two Runs at once (owner and admin): one 200 and one `pass-busy`, nothing joins (CT4, PX9).
- [x] A step that throws, or an add that is refused, leaves the chain working (CT5).
- [x] Queue off or not ready while another step holds the chain: refused at once (CT6, PX6).
- [x] The legacy fixed id `reconcileTaggingEdges`: keyed `@timestamp`, stopped by job id, recorded as "another way" (CT9, CT45, JG15, JG19, TV100, TV102, B108).
- [x] The seed id form `repeat:sched:seed:reconcileTaggingEdges:<millis>`, colons and all (CT10, CT36, JG17, SR81, PX21, TV106, B84, B93).
- [x] Each of the four queue reads failing or hanging; one shared deadline (CT12, CT13).
- [x] A job that moves or vanishes between reads; undefined entries (CT23).
- [x] Cache generations: a stale in-flight snapshot is neither served nor stored (CT24).
- [x] An add that times out and lands later (R1); no start left behind (CT28, PX11, RT35).
- [x] The finishing window: the job is still active after the pass exits (CT18, CT29, JG24, PX18).
- [x] The confirm route meets a pass whose record appeared after its re-read (CT31, RT33), and one that is busy only with stopped passes (CT32, RT36).
- [x] A record that gives a read error stays unchanged, byte for byte, after a Stop, a scheduled start, a confirmation start and a give-up (CT34, CT49, CT55, JG18, JG25).
- [x] A damaged record is renamed aside with its bytes kept (CT56, CT57, PX28).
- [x] Pruning at 40 entries, and with no queue read yet or a failed one (CT53, CT54).
- [x] A schedule start written late sorts by its time (CT52, JG17).
- [x] A pass gives up while a due scheduled run waits behind it (CT61, B93).
- [x] A due scheduled run behind a pass reads "the schedule" before pickup (TV106, B84).
- [x] After a restart, an admin stops the orphan; the orphan ends while its job is still stale-active; nothing is busy, and Run lines up (CT47).
- [x] A stalled re-run of a key with `noRerun` (CT20, CT37, CT46, JG16).
- [x] A claim lands between each pair of the D12 verdict's reads (CT60).
- [x] A Stop catches a starting pass, which is then refused at its identity check: too late, with the stop recorded (CT42).
- [x] The pid wait times out (`pass-not-reachable`), with running targets acted on first (CT43, TV91, B107).
- [x] A reused pid, a newer latest pass, and `kill` throwing ESRCH (CT44).
- [x] A running pass stopped while the queue cannot be read (CT48, TV86).
- [x] A stopped run whose start was not recorded; a stopped hand run with no job id; a signal no one recorded (TV103, B103).
- [x] A first pass waits, and Run is pressed, with no report yet (CT26, B89).
- [x] Body rules at each boundary (one and fifty targets, a 120-character key, the allowed characters), and `{}` only for Run (PX5, PX21).
- [x] Odd thrown codes reach no answer; `cause` is allow-listed (PX12, PX26, PX30, CT27).
- [x] Query forms `taskName[]` and `taskName[0]` reach the branch; nothing starts this pass outside it (PX36).
- [x] An owner key that `OWNER_RE` rejects but the middleware admits (PX15).
- [x] No load-time side effects (CT2, JG2, SWR80–SWR82, SR87).
- [x] A SIGTERM before the pessimistic save, during `finish()`, and on a first-save failure (SR78, SR80, SR86).
- [x] A client clock far from the server's (TV108).
- [x] A fetch whose signal is ignored, or whose body never arrives (TF28); a throwing `fetchImpl` (TF29).
- [x] A kept record body after a failed read is never shown (TV107, B111).
- [x] A Retry while the off prompt is open (PS34, B113).
- [x] A lapsed session, and a viewer who is no longer owner or admin (B105).

## Test infrastructure

- **Runner.** Node's `test/test.js` over `test/registry.js`. Read a run's result from its record (`npm run gate:status`), never from a pipe. When the host's live suites are red, compare suite by suite against a labelled baseline.
- **Node 22 for CI parity.** `.github/workflows/test.yml`'s `stack-free` job runs `npm ci && npm test` on Node 22 with no stack. The CT and PX headers also claim Node 16; the red phase above was checked on 22.23.3.
- **The stack-free constraint.** Every story 6 Node suite is hermetic. None touches Redis, Neo4j, strfry, the network, the host's `/proc` or `/var/lib/brainstorm`:
  - `TAGGING_EDGES_STATE_DIR` is a temp dir for each whole run, and `BRAINSTORM_STRUCTURED_LOGGING=false`;
  - CT, JG and PX replace `process.kill` with a guard that signals nothing, so every signal goes through the injected `kill` dep;
  - PX checks each world's `stateDir()` for a stray `record.json` after every test;
  - only fake 64-hex keys are used (OWNER `a…`, ADMIN `d…`, STRANGER `c…`).

  "Queue unavailable" and "cannot tell" cannot be shown live with a signed-in viewer (R5), so they are proven with injected deps and browser mocks.
- **`test/helpers/taggingEdgesPassFakes.js`** (new; load-safe, Node built-ins only at load). Its self-check runs with `node test/helpers/taggingEdgesPassFakes.js`, and as JG0 inside the gate, and passes 19 / 0. It provides:
  - `loadModule`, which names the missing module and the ADR decision, so every suite loads in the red phase;
  - a BullMQ-faithful fake queue (probes P1, P2, P5, Q2, Q3), whose id rule is BullMQ's own (`bullmqRejects`: a real `Job` and `validateOptions`, no Redis; ledger `2026-10-14-fakes-hide-library-validation`). No `test/probe-*.js` was committed;
  - a fake Redis for the real `resourceSemaphore`, and a scripted semaphore with D4's contract;
  - `makeWorld`, the § Seams deps list as one ordered call log, plus a process table, an in-memory record store and a fixed clock (T0 = 2026-10-27T12:00:00Z);
  - `FAST_TIMERS` (step 150 ms, pid wait 2000 ms, pid poll 10 ms, ended keys 2000 ms), against `ADR_TIMERS` (2000, 3000, 100, 10000). Only the tests that wait a window out shorten it: CT43 (pid wait 300 ms), CT19 and JG24 (ended keys 200 ms);
  - `guardProcessKill`, installed around CT's, JG's and PX's runs, so no fake pid can ever reach a real process;
  - `recordStructuredEvents` and `captureConsole`, for PX38's who-is-never-logged check;
  - `adrWorkerCallback`, `makeFakeProcessor`, `passReq`, `fakeRes` and `callHandler`.
- **`test/helpers/taggingPipelineFixtures.js`** (extended). It adds the status's `control` member (`busyItem`, `controlBody`, `withControl`), the pass record's answers, the Run and Stop answers, and `applyRun` / `applyStop` (the browser mock acts as the server would). It also adds `PASS_TIMES` (one minute each, near NOW), `PASS_KEYS` (none containing an 8-hex key, so "no who" can be checked) and `ACTOR`. Story 4's and 5's status bodies carry no `control`.
- **The queue-integration cases.** JG9–JG13 run the real `initTaskQueue` with stand-ins for `bullmq`, `ioredis`, `./processor`, `./resourceSemaphore` and `./jobGates` installed in `require.cache`, and every entry is restored afterwards.
- **The real-middleware child.** PX33–PX37 spawn `node -e` (90 s cap) with:
  - a temp `brainstorm.conf` (`BRAINSTORM_CONF_PATH`) naming the owner, and a temp `settings.json` (`TAPESTRY_SETTINGS_PATH`) naming the admin;
  - every `child_process` entry point replaced by a recorder that launches nothing;
  - the task-queue module stubbed in `require.cache`;
  - the `handleRunTaskForPass` export wrapped at call time, so a branch that captured the function at load reads as "delegate never reached".

  Results come back on one `@@PX-CHILD@@` line. PX32, SWR78–SWR84, SR82 and CT2 also run in child processes.
- **Firmware.** No precondition; no concept changes.
- **The browser lane** (not in CI):
  - **Build** inside the container into the gitignored `tmp/tp-dist`, never `dist/`. Serve it on `:4174`, and run under Node 22 with Chromium, with `BRAINSTORM_SERVER_ACCESSIBLE=true`.
  - **The page** runs in UTC with `en-GB`, on `page.clock` from `F.NOW`. Every `/api` route is mocked; the catch-all is registered first and answers 599.
  - **B39 is red before and after this story** (stale baseline, untracked ledger row `ledger/2026-10-28-relay-subtab-baseline-stale.md`). Compare against a baseline run, and do not re-record the AC-6 baseline here.
- **Live evidence** (local stack, then staging) is not part of the gate. See ADR 0006 § Seams "Live and evidence": restart the backend first, the heavy-lock `HSET`, `kill -STOP`/`-CONT`, and the in-container local `curl`.

## How to run

The whole gate:

```
npm test
npm run gate:status
```

One suite, through its `run()` export, on Node 22:

```
<node22>/bin/node -e "require('./test/tagging-edges-pass-control.test.js').run().then(r=>{console.log(r.pass,r.fail,r.skipped);process.exit(0)})"
```

Each story 6 suite in turn, from the repo root:

```
for s in tagging-edges-pass-control task-queue-job-gate tagging-edges-pass-routes tagging-edges-wiring \
         tagging-edges-state-routes tagging-edges-runner tagging-pipeline-codes tagging-pipeline-view \
         tagging-pipeline-fetch tagging-pipeline-panel-source tagging-edges-switch-record \
         tagging-edges-realtime-engine; do
  <node22>/bin/node -e "require('./test/$s.test.js').run().then(r=>{console.log('$s',r.pass,r.fail,r.skipped);process.exit(0)})"
done
<node22>/bin/node test/helpers/taggingEdgesPassFakes.js   # the fakes' self-check
```

The browser spec:

```
docker exec tapestry sh -c 'cd /usr/local/lib/node_modules/brainstorm/ui && npx vite build --outDir ../tmp/tp-dist --emptyOutDir'
python3 -m http.server 4174 --bind 127.0.0.1 --directory tmp/tp-dist      # in the background
BRAINSTORM_SERVER_ACCESSIBLE=true BRAINSTORM_BASE_URL=http://localhost:4174 PATH=<node22>/bin:$PATH \
  npx playwright test tests/brainstorm/tagging-pipeline-panel.spec.js --project=chromium
# story 6's class alone: add  -g "tagging-edges #6"   (B9, B10, B38 and B113 sit in the story 4 and 5 classes)
# afterwards: stop the server; rm -rf tmp/tp-dist
```

## Choices the suites make

Where ADR 0006 leaves something open, the suites accept every reading it allows. Where a test had to pick one, the
choice is stated in that suite's header. The ones an Implementer will meet:

- **`randomKey()` returns the whole job id** (`LINEUP_ID`-shaped), not its 12 hex digits (CT8b pins the default).
- **`lineUp` and `stop` return shapes are open.** Tests read observable effects (answers, the fake queue, the record,
  signals). `snapshot` is called so that both `snapshot(d, {fresh})` and an instance's `snapshot({fresh})` work.
- **An add that times out answers 503 `QUEUE_UNAVAILABLE`** (D14, R1). One that is refused may answer 503 or 500
  `{code: 'error', cause}`.
- **The queue-off refusal lives in the handlers** (PX6, PX6b), not in `lineUp`.
- **A local call that `sameHost` refuses** carries the same sentence as every `sameHost` refusal, "cross-site request
  refused" (PX15, PX34).
- **The panel's state lives in `TaggingPipelinePanel`**, as `{pending, outcome}` and `{snapshot, confirmation, pending,
  outcome}` (PS30). Only the three named senders may POST (PS13), so a shared POST helper fails PS13.
- **An early SIGTERM is honoured at the existing first safe point** (SR78). No new check point is added before running
  begins.
- **`passWho`'s answer carries each run's `runId` and each busy item's `key`**, so a join can be found.
- **Story 4's and 5's status fixtures carry no `control`.** Once the panel is built, those tests show "the server cannot
  tell whether a pass is waiting", which D16 requires for an absent member.

## Not covered, and limits

- **The fake queue's BullMQ behaviour** beyond the id rule (P2's join, P5 and Q2's remove answers, Q3's next iteration
  at pickup) is faked from ADR 0006's probe run of 2026-10-02 against BullMQ 5.76.10. JG0 checks the fake against those
  recorded facts, not against BullMQ. On any BullMQ upgrade, re-run the ADR's probe in the container (its own key
  prefix, obliterated after) before trusting CT4, CT8, CT36 and CT63.
- **"Queue unavailable" and "cannot tell"** are shown only with injected deps and browser mocks (R5).
- **Live evidence** (the local stack, then staging) is the story's evidence plan, not the gate: ADR 0006 § Seams
  "Live and evidence".
- **B39** is red before and after this story (ledger `2026-10-28-relay-subtab-baseline-stale`).

## Verification

The new tests fail with the current code, each for the right reason: the module, export or behaviour ADR 0006 adds is
absent. Confirmed on 2026-10-28, on `6ffd0516` plus the uncommitted tests, through each suite's `run()` on Node
22.23.3, twice in a row with identical results (no flakiness):

| Suite | Pass | Fail | Skipped |
|---|---|---|---|
| tagging-edges-pass-control | 0 | 67 | 0 |
| task-queue-job-gate | 3 | 24 | 0 |
| tagging-edges-pass-routes | 1 | 38 | 0 |
| tagging-edges-wiring | 74 | 10 | 0 |
| tagging-edges-state-routes | 53 | 9 | 0 |
| tagging-edges-runner | 74 | 13 | 0 |
| tagging-pipeline-codes | 53 | 1 | 0 |
| tagging-pipeline-view | 82 | 26 | 0 |
| tagging-pipeline-fetch | 24 | 7 | 0 |
| tagging-pipeline-panel-source | 25 | 11 | 0 |
| tagging-edges-switch-record | 47 | 0 | 0 |
| tagging-edges-realtime-engine | 83 | 0 | 0 |
| stack-free-npm-test, G5 alone | 1 | 0 | 0 |

- **The browser spec** ran twice on Chromium against the rebuilt UI: 83 passed and 36 failed both times, none flaky.
  The failures are B9, B38 and B83–B115 (35, the feature absent) and B39 (pre-existing).
- **Every failing test is a new test or a revised pin** from the table above, and the counts add up exactly. For
  example, the runner suite's 13 are SR1, SR50, SR68, SR69 and nine of SR78–SR87 (SR87 passes); the panel-source
  suite's 11 are PS13, PS14, PS28 and PS29–PS36. So no test outside story 6's list changed from passing to failing.
- **Between the last two rounds of test review,** no test changed status; the only differences were added tests.
- **The pre-story full-gate baseline** is run `20261028T002652Z-23104-e887` (`[story6-baseline]`, at `cb7fe4f8` on Node
  22.23.3): 6,460 passed, 38 failed, 170 skipped, 312 suites. Its 16 failing suites are this host's live-stack failures,
  for comparing suite by suite after Implementation.
