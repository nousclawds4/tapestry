# Test Plan: Story 6 — Running and stopping the pass, on the panel

**Story:** `engineering-team/stories/tagging-edges/6-pass-run-and-stop.md`
**ADR:** `engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md`
**Date:** 2026-10-28

## The suites

| Suite | Story 6's tests | Level |
|---|---|---|
| `test/tagging-edges-pass-control.test.js` (new) | CT1–CT70, with CT8b, CT55b and CT58b (CT65–CT68 added after Implementation; CT69–CT70 at the fix round, and CT45's title revised) | component: one `createController(deps)` instance over the shared fakes. CT2 runs in a child process; CT57 uses the real store on a temp dir |
| `test/task-queue-job-gate.test.js` (new) | JG0–JG26 (JG0: the shared fakes' self-check) | module (JG1–JG4); queue integration (JG5–JG8: the real semaphore over a fake Redis; JG9–JG13: the real `initTaskQueue` over `require.cache` stand-ins); component (JG14–JG26) |
| `test/tagging-edges-pass-routes.test.js` (new) | PX1–PX39, with PX6b (PX21 revised and PX39 added after Implementation) | handler with injected deps (PX1–PX31, PX39); child process (PX32: `pass.js`'s real defaults; PX33–PX37: the real `authMiddleware` in front of the real `handleRunTask`) |
| `test/tagging-edges-wiring.test.js` | SWR75–SWR86 (SWR85 and SWR86 added at the fix round) | source pin (SWR75, SWR77); module (SWR76); child process (SWR78–SWR86) |
| `test/tagging-edges-state-routes.test.js` | RT17, RT18, RT19 (revised); RT32–RT38 | handler |
| `test/tagging-edges-runner.test.js` | SR1, SR50, SR68, SR69 (revised); SR78–SR87 | unit over injected ports; SR82 runs in a child process |
| `test/tagging-pipeline-codes.test.js` | PC1, PC3, PC42 (revised titles); PC54's floors (`codeValues`, `codeValueLiterals`); PC55's title (revised at the fix round) | source pin |
| `test/tagging-pipeline-view.test.js` | TV83–TV110 (TV90 revised and TV109–TV110 added after Implementation) | unit, pure and clock-free |
| `test/tagging-pipeline-fetch.test.js` | TF25–TF31 | unit, with an injected `fetchImpl` |
| `test/tagging-pipeline-panel-source.test.js` | PS13, PS14, PS28 (revised); PS29–PS38 (PS37–PS38 added after Implementation) | source pin |
| `tests/brainstorm/tagging-pipeline-panel.spec.js` | B9, B10, B38 (revised); B83–B117 (B116–B117 added after Implementation) | browser (Playwright on the rebuilt UI, every `/api` route mocked) |
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
| AC-6, follows, mutes and reports are untouched | By construction: no module in `control/*.js`, `pass.js` or `jobGates.js` requires a graph module (the Neo4j driver or `graph.js`), directly or through what they require, and the runner's diff changes no graph statement or write (`graph.js` is not in it). Plus the runner suite, which pins what the pass writes (the row "AC-6, the pass behaves as story 2 defines"). No source pin like story 5's switch-record SR47 was added | runner | unit; by construction |
| AC-6, Run and Stop leave the real-time path's switch, the Scheduled Tasks entries and the job schedulers alone; the pass catches up after a stopped pass | CT63 (the queue's full surface wrapped, so any remove or scheduler call is seen; `realtime/switch.json`, `switch-history.json` and `scheduled-tasks.json` byte-for-byte unchanged after Run, three kinds of Stop and a refused Stop); CT36; RE70b | pass-control; realtime-engine | component |
| AC-6, the pass behaves as story 2 defines; a stopped pass leaves its writes | SR50, SR81, SR83, SR85, SR86; the runner suite's existing SR2–SR77 | runner | unit |
| AC-6, with the path on, it catches up after any pass ends, a stopped one included | RE70b. The engine asks for its catch-up when a watched run's process is no longer alive (`realtime/index.js:995-998`), whatever the outcome; RE70b pins that for `stopped` | realtime-engine | component |
| AC-6, the confirm route and its console snippet work as before | RT17, RT18, RT19, RT32–RT36; SWR84; CT31–CT34 | state-routes; wiring; pass-control | handler; child process; component |
| AC-6, the panel's reads still change nothing; only this story's requests are sent | PS13, PS14, PS28; TF31; B38; TF1 (unchanged) | panel-source; fetch; spec | source pin; unit; browser |
| AC-6, the opening line; the pass section's line on how a pass starts | PS35, B112; PS36, B9 | panel-source; spec | source pin; browser |
| AC-6, the copy C5-4 changes (the panel change, D20) | PS34; B113 | panel-source; spec | source pin; browser |
| AC-6, C5-6's copy: taken. The `no-status` sentence now names a fault in the driver itself | PC55 (its title reworded at the fix round to name the copy as taken; its checks unchanged) | codes | source pin |
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

**Added after Implementation (2026-10-28)** — the owner's two decisions on the implemented story: "Widen the rule"
(ADR 0006 Amendment 1 § A, § B) and "Add them now" (pins for the readings Amendment 1 § C ratified, which the
Implementer's own check changed after Test Design: story § Deviations, last group):

| Criterion or reading | Test ids | Test file | Level |
|---|---|---|---|
| Amendment 1 § A: Stop's key is any string of 1 to 256 code units with no control character and no U+2028 or U+2029; both sides of each boundary; the 400 names the new rule | PX21 (revised) | pass-routes | handler |
| Amendment 1 § A, end to end: a job added another way under an id the old rule refused but BullMQ accepts (`manual run`, `job/1`, 130 characters) is listed busy; a Stop naming it with the pass's other open items answers 200, each taken out of line and recorded under its own key; the gate skips each at pickup, and one waiting for the heavy-task lock abandons its wait | PX39 | pass-routes | handler, through the real controller and gate over the fake queue (BullMQ's own id rule) |
| § C, D6 step 3 and D8: a Run's or the confirm route's start whose add is refused or times out, over a record at the history's cap (10 lines, 10 entries), leaves the record byte for byte as before | CT65 | pass-control | component |
| § C, D5: a stop mark covers only its own execution — after a Stop recorded: false and gate.ended, a re-run of the same job id (a stall; a BullBoard add) lists stopAskedAt null waiting, waiting for the lock, starting and running, and a Stop of it answers asked-to-stop with one SIGTERM to its own pid | CT66 | pass-control | component |
| § C, D11: pruning keeps a stopped hand run's `run:<runId>` entry (jobId null) after its history line ages out, while the run is latest or previous in report.json | CT67 | pass-control | component |
| § C, D11: job ids `__proto__` and `constructor` are own record entries, through the gate's start "another way" and through a Stop (read back after a restart); Object.prototype gains nothing | CT68 | pass-control | component |
| § C, D17: a read that cannot tell (control.queue `read-failed`; no control member) never closes an open Stop prompt; a known, empty read then does | B116; PS37 | spec; panel-source | browser; source pin |
| § C, D16: a busy running item with a run, served beside status.running false (D5's 1 s reuse), never says "Stopped on request" or "ended first" beside "Running since" | TV109 | view | unit |
| § Deviations (the Implementer's under D17): focus inside PassControls survives the empty-to-ready switch — Cancel, "Stop the pass" and "Run a pass now" | B117; PS38 | spec; panel-source | browser; source pin |
| § Deviations (copy): the plural too-late sentence never says "some" when every target came too late | TV110 | view | unit |
| § Deviations (copy): "asked to stop" in the past tense — every sentence of an accepted Stop's text is checked | TV90 (revised) | view | unit |

Amendment 1 § B's residual R9 needs no test of its own (the ADR says so); PX21's boundary cases cover its 400.

**Added at the fix round (2026-10-28)** — what story 6's review, round 1, asked of the Tester, item by item:

| Review item | Criterion or reading | Test ids | Test file | Level |
|---|---|---|---|---|
| Blocking 1 | D2, amended: "Every comparison with a report's job.id uses the busy item's own jobId — the queue job's id, or for a live pass the report's — never the key." A pass whose job id is `reconcileTaggingEdges@x` (a queue-dashboard add, keyed by its own id) is stopped by that id. Running, with its start recorded at pickup or not: `asked-to-stop`, exactly one SIGTERM to its own pid through the injected `kill`, and its stop entry's `jobId` is `reconcileTaggingEdges@x`. Starting (no record yet): the Stop waits for the first record naming that id and signals its pid, never `pass-not-reachable` | CT69 | pass-control | component |
| Requested change 5 | A time outside a JavaScript Date's range makes nothing throw. Three waiting jobs: `repeat:sched:99999999999999999`, `repeat:sched:8640000000000001` (one past the range) and a job whose timestamp is 1e17. For each, the snapshot and the status's `control` read queue `ok` and list the job waiting with `since: null`; a Run answers 409 `pass-busy`; the confirm route's start joins; a Stop answers 200 `taken-out-of-line`, recorded, with no schedule start. At pickup, `beforeAcquire` answers `go` and records the start at a valid time. A record whose give-up time is 1e17 still gives a snapshot and the status, and a Run lines up | CT70 | pass-control | component |
| Requested change 6 | A job id that carries NUL reaches no spawn environment, for the pass and for another task: no `BRAINSTORM_TASK_JOB_ID` and no value holding NUL, while the launcher's arguments, `BRAINSTORM_STRUCTURED_LOGGING` and the inherited environment are as for any job. An ordinary id beside them still carries the variable (SWR78 covers the rest) | SWR85 | wiring | child process |
| Requested change 6, its follow-up | D10's note at the fix round: the processor also leaves `BRAINSTORM_TASK_JOB_ID` out for an id longer than 200 characters (UTF-16 code units, `String.prototype.length`), D10's pattern's bound, so no id can make the one environment string Linux refuses at 128 KiB or more (`E2BIG`). For the pass and for another task, an id of 201 code units carries no variable, one with a character outside the BMP among them; ids of exactly 200 code units, one with such a character, carry it unchanged. The launcher's arguments, `BRAINSTORM_STRUCTURED_LOGGING` and the inherited environment are as for any job | SWR86 | wiring | child process |
| Blocking 1, its follow-up | The comments on two test helpers no longer name D2's removed rule. `jobIdOf` (`test/helpers/taggingPipelineFixtures.js`) and `jobIdOfKey` (`test/helpers/taggingEdgesPassFakes.js`, its index line and the function) now say what each is: the default `jobId` a fixture key implies, the legacy id for a legacy key. A dashboard id such as `reconcileTaggingEdges@x` is its own key, and that key has the legacy form, so the helpers read it as the legacy id (for `@<digits>` it is a legacy job's very key, R9 (d)); a fixture for one passes its `jobId`. Names and behaviour unchanged | — (comments only) | the two helpers | — |
| Blocking 1, its second follow-up | D-a2: the snapshot's finishing-window check (D5) compares the report's `job.id` with the job being classified, not with the phase stored under the key. Outside R9 (d) the two are always equal (the gate stores `String(job.id)` under `keyOf(job)`), so no behaviour changes and no test pins it; R9 needs no test of its own (the ADR says so). pass-control is 73 / 0 before and after | — (unpinned, by design) | — | — |
| Requested change 7 | C5-6's copy was taken. PC55's title now names the copy as it stands: a fault in the schema check's own code, in the driver itself, or in another library, never Neo4j's answer | PC55 (title only) | codes | source pin |
| Requested change 8 | AC-6's "Follows, mutes and reports are untouched", with its basis | the AC-6 row above | — | by construction; unit |

BullMQ accepts a `:` in a custom id only as exactly two of them (`node_modules/bullmq/dist/cjs/classes/job.js:1043-1045`
at 5.76.10). So the seed form `repeat:sched:<entry>:<millis>` cannot be added by hand, and CT70 uses
`repeat:sched:<millis>`, the form the review's probe used.

### ADR 0006, by decision group

| Decision | Test ids | Test file | Level |
|---|---|---|---|
| **Controller** D1: the module, one instance, the chain, refusals outside the chain | CT1–CT6; JG14, JG23; SWR81 | pass-control; job-gate; wiring | component; child process |
| D2: an id per start, `LINEUP_ID` accepted by BullMQ, the legacy key, the id's millis; every comparison with a report's `job.id` uses the busy item's own `jobId` (amended at the fix round, replacing `jobIdOf`) | CT7–CT10, CT45, CT69 | pass-control | component |
| D5: the busy snapshot (read order, one shared deadline, the four queue states, the liveness key rules, every classification branch, `stopAskedAt`, sort order, moves between reads, the status-only cache; a time a Date cannot hold) | CT11–CT24, CT70; JG20, JG24 | pass-control; job-gate | component |
| D6: Run in the controller (the record first, busy, record unavailable, a failed add, the finishing window, the queue off) | CT25–CT30 | pass-control | component |
| D8: the confirm route's start (join, line up, queue not ready, a failed add, cannot be refused) | CT31–CT34; RT17, RT18, RT19, RT32–RT36; SWR84 | pass-control; state-routes; wiring | component; handler; child process |
| D9: Stop (waiting, scheduled, running, stale prompt, nothing to stop, pid wait, the signal check, legacy, `run:` targets, restart, queue down, unrecordable, either role; a job id that starts `reconcileTaggingEdges@`) | CT35–CT50, CT69 | pass-control | component |
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
| D10: the `job` port, `BRAINSTORM_TASK_JOB_ID`, and the processor's spawn environment (left out for an id that carries NUL or is longer than 200 characters) | SR1, SR81, SR82; SWR78, SWR85, SWR86 | runner; wiring | unit; child process |
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
| PX21 *(revised 2026-10-28)* | D9's key rule as amended by ADR 0006 Amendment 1 § A: 1 to 256 UTF-16 code units, no U+0000–U+001F, U+007F–U+009F, U+2028 or U+2029; both sides of each boundary (Edge cases above); the 400's sentence names 256, not 120. The header's "Body validation" choice now pins the empty key too | fails against `ca504c42` (the old rule's 400) |
| `F.applyStop` (`test/helpers/taggingPipelineFixtures.js`) *(revised 2026-10-28)* | the browser mock's Stop body check follows Amendment 1 § A (`isStopKey`, written with ASCII escapes) | no browser test sends a key outside the old rule, so no B test changes status |
| CT45 *(title revised at the fix round, 2026-10-28)* | the title cites D2's amended rule (the busy item's own `jobId`, never the key) in place of "uses jobIdOf, never the key"; the body is unchanged | passes before and after the fix |
| PC55 *(title revised at the fix round, 2026-10-28)* | the title names C5-6's copy as taken: a fault in the schema check's own code (what it passes to the driver included), in the driver itself, or in another library, never Neo4j's answer; the checks are unchanged | passes |
| TV90 *(revised 2026-10-28)* | every sentence of each accepted Stop's text must hold a past-tense verb (`pastProblems`), for one pass, two passes of each `how`, a waiting and a running pass, and an unrecorded Stop; it had read only the whole text, so "It stops at its next safe point." beside a past sentence passed | passes at `ca504c42`; fails with that sentence put back (Verification) |

Pins that pass now, by design: JG0 (the fakes' self-check), JG8, JG13, PX37, RT19, SR87, PC3, PC42, PC54, RE70b, B10, and B58 (title only). Each pins behaviour story 6 must keep, or a floor that holds before and after.

## Edge cases

- [x] Two Runs at once (owner and admin): one 200 and one `pass-busy`, nothing joins (CT4, PX9).
- [x] A step that throws, or an add that is refused, leaves the chain working (CT5).
- [x] Queue off or not ready while another step holds the chain: refused at once (CT6, PX6).
- [x] The legacy fixed id `reconcileTaggingEdges`: keyed `@timestamp`, stopped by job id, recorded as "another way" (CT9, CT45, JG15, JG19, TV100, TV102, B108).
- [x] A queue-dashboard id that starts `reconcileTaggingEdges@` (`reconcileTaggingEdges@x`): keyed by its own id, and stopped by it, running and starting (CT69). *(Added at the fix round, 2026-10-28.)*
- [x] A time a Date cannot hold, in a scheduled id's millis, a job's timestamp or a record's give-up time (CT70). *(Added at the fix round, 2026-10-28.)*
- [x] A job id that carries NUL, for any task: no `BRAINSTORM_TASK_JOB_ID` in the spawn environment (SWR85). *(Added at the fix round, 2026-10-28.)*
- [x] A job id longer than 200 UTF-16 code units, for any task: no `BRAINSTORM_TASK_JOB_ID`; at exactly 200 it is carried unchanged, a character outside the BMP counting as two (SWR86). *(Added at the fix round, 2026-10-28.)*
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
- [x] Body rules at each boundary, and `{}` only for Run (PX5, PX21). *(Revised 2026-10-28 for ADR 0006 Amendment 1 § A, which superseded D9's "at most 120 characters of `[A-Za-z0-9:._@-]`".)* PX21 now pins one and fifty targets (0 and 51 refused); keys of 1 and 256 UTF-16 code units and 128 emoji accepted, and 0, 257 and 128 emoji plus one refused; `manual run`, `job/1`, `__proto__`, `constructor`, U+0020, U+007E, U+00A0, U+2027, U+202A, U+200B, U+FEFF, a lone surrogate and six characters the old rule refused, all accepted; U+0000, U+0009, U+000A, U+000D, U+001F, U+007F, U+0080, U+0085, U+009F, U+2028 and U+2029 refused at a key's start, inside it and at its end; keys distinct as they are (case, a trailing space and normalisation each make a distinct key; the same key twice is refused); fifty 256-unit keys accepted; and the 400's sentence names 256, not 120.
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
  - **B39 is red before and after this story** (stale baseline, ledger row `ledger/2026-10-28-relay-subtab-baseline-stale.md`). Compare against a baseline run, and do not re-record the AC-6 baseline here.
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
- **Stop's key rule is Amendment 1 § A's** (2026-10-28): length is `key.length` (UTF-16 code units), and the
  forbidden set is exactly U+0000–U+001F, U+007F–U+009F, U+2028 and U+2029. The 400's wording is the Implementer's;
  PX21 asks only that it names 256 and not 120. Every test file builds such characters from code points or writes
  them as ASCII escapes, never raw (a raw U+2028 in a regex literal is a SyntaxError).
- **The pins added after Implementation read the as-built code's contract, not its form,** except PS37 and PS38,
  which are the source halves of B116 and B117 (the browser lane is not in CI).
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

### After Implementation (2026-10-28): ADR 0006 Amendment 1, and the pins for the Implementer's own check

Run on `ca504c42` plus the uncommitted test changes, through each suite's `run()` on Node 22.23.3, twice for the four
changed suites with identical results.

**Red phase for "Widen the rule" (Amendment 1 § A).** Only PX21 and PX39 fail, each because `pass.js` still applies
D9's old rule. Every refusing case of PX21 already answers 400 under the old rule. 21 of its 30 accepting cases fail,
all of them keys outside `[A-Za-z0-9:._@-]{1,120}`, along with the 400's sentence. Excerpts:

```
FAIL  PX21: … the 400's error sentence should name the amended key rule (1 to 256 characters) and not D9's old 120
      (ADR tagging-edges/0006 Amendment 1 § A); it is "the body must be {\"targets\": [{\"key\": …, \"state\": \"waiting\" |
      \"running\"}]}, 1 to 50 distinct keys of at most 120 characters of A-Z a-z 0-9 : . _ @ -"
      the id "manual run": should pass validation and, with nothing busy, answer 409 nothing-to-stop (ADR tagging-edges/0006
      Amendment 1 § A; D9 step 2); it answered 400 {"error":"the body must be … at most 120 characters of A-Z a-z 0-9 : . _ @ -", …}
      the id "manual run": the chain step never ran
FAIL  PX39: … 2 of 2 case(s) failed:
      [the odd jobs wait in line beside the owner's pass] the admin's Stop naming every open item should answer 200 (ADR
      tagging-edges/0006 Amendment 1 § A: the server only compares a key with its own busy list); it answered 400 {"error":
      "the body must be … at most 120 characters …"}
      [one odd job was picked up and waits for the heavy-task lock, the others wait in line behind it] … it answered 400 …
```

The tests can be met: with Amendment 1 § A's predicate patched into a scratch worktree's `pass.js` (and a 400 sentence
naming 256), PX21 and PX39 pass and the routes suite is 40 / 0.

| Suite | Pass | Fail | Skipped | Failing |
|---|---|---|---|---|
| tagging-edges-pass-control | 71 | 0 | 0 | — |
| task-queue-job-gate | 27 | 0 | 0 | — |
| tagging-edges-pass-routes | 38 | 2 | 0 | PX21, PX39 (red phase) |
| tagging-edges-wiring | 84 | 0 | 0 | — |
| tagging-edges-state-routes | 62 | 0 | 0 | — |
| tagging-edges-runner | 87 | 0 | 0 | — |
| tagging-pipeline-codes | 54 | 0 | 0 | — |
| tagging-pipeline-view | 110 | 0 | 0 | — |
| tagging-pipeline-fetch | 31 | 0 | 0 | — |
| tagging-pipeline-panel-source | 38 | 0 | 0 | — |
| tagging-edges-switch-record | 47 | 0 | 0 | — |
| tagging-edges-realtime-engine | 83 | 0 | 0 | — |
| the fakes' self-check | 19 | 0 | — | — |

**Teeth for "Add them now".** Each new pin passes at `ca504c42`. In a scratch worktree at `ca504c42`, with the new
tests copied in, only that pin's fix was undone by hand (the lines named below), its suite was run, and the file was
restored with `git checkout` inside the worktree before the next one. Each undone fix failed only its own new test.
The older pins named in the last column stayed green, which is the gap each new pin closes.

| Pin | Fix undone (the as-built line, then the reverted form) | Failing message | Older pins, still green |
|---|---|---|---|
| CT65 | `takeBack(prior)` writing back `prior.passes` and `prior.history` → `takeBack(key)` deleting only the start's entry and its line, at both call sites | 4 of 4 cases: "the record should be byte for byte as it was before the start … it now holds 9 lines and 9 entries — lines lost ["reconcileTaggingEdges-a00000000258"], entries lost [the same]" | CT28, CT33 |
| CT66 | `stopAskedOf`'s `mine = !!mark && it.state === 'running' && (runId … : since ≤ mark)` → `mine = !!mark` | both cases: "the re-run, waiting / waiting for the lock / starting / running: stopAskedAt should be null; it is 2026-10-27T12:00:01.000Z"; "a Stop of the re-run … answered 409 nothing-to-stop"; "should send one SIGTERM to its own pid 5002; it sent []" | CT21, CT37, CT40 |
| CT67 | `prune`'s `joined` loses its `stop.runId` clause | both cases (latest; previous): "the hand run's run:20261027T120000Z-… entry should be kept while its run is in report.json … the record's entries are [the five Run keys]" | CT53, CT54 |
| CT68 | `entryAt` without `hasOwnProperty`; `entryIn` assigning `r.passes[key] = …` instead of `Object.defineProperty` | `__proto__`: "the record should hold an own entry under "__proto__" … its own keys are []"; "startRecorded should be false; it is true"; "Object.prototype gained ["skip","start","stop"]"; "a plain object {} now reads ["start","stop","skip"] through its prototype". `constructor` passes either way (an own data property was always assigned), so `__proto__` carries the teeth | CT51 |
| PS37 | `nothingBusy = !!busy && busy.known && …` → `!!busy && busy.items.length === 0` | "TaggingPipelinePanel.jsx:202: this effect clears the Stop prompt without reading busyView's known (deps ["nothingBusy"])" | — |
| B116 | the same, in a copy of the built bundle (`q=!!I&&I.known&&I.items.length===0` → `q=!!I&&I.items.length===0`), served from the scratch folder | "a poll whose queue read failed: the prompt stays open … toBeVisible() failed … element(s) not found" | B115 |
| TV109 | `passWho`'s busy item `runWho(run, entries, true)` → `runWho(run, entries, isLive(run))` | "the running item … must not read as ended beside its "Running since" line …; it says ["Stopped on request by an admin (ab12cd34…) at"]" | TV105 |
| PS38 | both `<PassControls key="pass-controls" …>` → no key | "PassSection.jsx:191: <PassControls> carries no string-literal key; PassSection.jsx:208: …" | PS29 |
| B117 | the same, in a copy of the built bundle (both `t.jsx(ZO,{…},"pass-controls")` → no third argument) | case 2: ""Stop the pass" keeps focus across the switch … toBeFocused() failed … Received: inactive". Case 1 (Cancel) passes either way, because a remounted prompt focuses its Cancel again; that is why cases 2 and 3 exist. Case 3 alone (a scratch copy of the spec without cases 1 and 2): ""Run a pass now" keeps focus across the switch … Received: inactive" | B89 |
| TV110 | the plural too-late sentence → "Some stops came too late to take effect: …" | "stopOutcome(200, 2 too-late) [and 3]: every target came too late, so the sentence must not say "some"" | TV90 |
| TV90 (revised) | the singular asked-to-stop sentence → "The running pass was asked to stop. It stops at its next safe point." | "every sentence must be in the past tense (D16); these are not: ["It stops at its next safe point."]", for one pass, a waiting and a running pass, and recorded false. TV90 as it stood at `ca504c42` passes with that sentence (108 / 0) | — |

**The browser spec** ran once on Chromium against the current UI (`ui/src` at `ca504c42`), built in the container into
`tmp/tp-dist`: 120 passed and 1 failed. The failure is B39, which was failing before this story (ledger
`2026-10-28-relay-subtab-baseline-stale`). B116 and B117 pass. `tmp/tp-dist` was removed afterwards. The browser teeth
used copies of that build in the scratch folder, each with one fix undone in the minified bundle, served on their own
ports. No source file was changed.

### Fix round (2026-10-28): story 6's review, round 1

Run on `2a361338` plus the uncommitted test changes, with `src/` as committed, through each suite's `run()` on Node
22.23.3, twice with identical results:

| Suite | Pass | Fail | Skipped | Failing |
|---|---|---|---|---|
| tagging-edges-pass-control | 71 | 2 | 0 | CT69, CT70 (red phase) |
| tagging-edges-wiring | 84 | 2 | 0 | SWR85, SWR86 (red phase) |
| tagging-pipeline-codes | 54 | 0 | — | — |

*(SWR86 was added later in the round. The wiring row is from one run in a scratch copy of the working tree, with
`src/` restored to `2a361338`, so the checkout was not touched. Before SWR86 it was 84 / 1 / 0, SWR85 failing.)*

Every other test in the three suites keeps its status, CT45 and PC55 (titles only) included. Each new test fails
because the code still does what its review item names, never at load or in setup:

```
FAIL  CT69: … 3 of 3 case(s) failed:
  [running, its start recorded at pickup] stop(…) … stopped should be [{"how":"asked-to-stop","key":"reconcileTaggingEdges@x"}];
    it is [{"how":"too-late","key":"reconcileTaggingEdges@x"}] …
    its own pid 5001 should get exactly one SIGTERM through the injected kill; signalled []
  [running, its start not recorded at pickup (…)] … it is [{"how":"too-late", …}] … signalled []
    the stop: the record's entry for reconcileTaggingEdges@x should have {"jobId":"reconcileTaggingEdges@x", …};
    it has {"jobId":"reconcileTaggingEdges", …}
  [starting: launched, its first record not written yet] … status 409, not 200 … it answered
    {"code":"pass-not-reachable","success":false} … signalled [] … it has {"jobId":"reconcileTaggingEdges@x","noRerun":false,"stop":null}
FAIL  CT70: … 3 of 3 case(s) failed:
  [repeat:sched:99999999999999999, waiting] the busy list: the snapshot should resolve; it rejected: Invalid time value
    the busy list: the status's control should read queue 'ok'; it reads "read-failed" (busy [])
    the busy list: a Run: … should answer status 409; it answered 500
    the busy list: the confirm route's start should join the waiting job (200 { enqueued: true, joined: true }); it
      answered 500 {"cause":"error","code":"error","enqueued":false,"success":false}
    the busy list: a Stop: … status 500, not 200 …
    the gate: beforeAcquire should answer 'go'; it rejected: Invalid time value
    the gate: the snapshot while it waits for the lock should resolve; it rejected: Invalid time value
  [repeat:sched:8640000000000001, waiting] … the same lines
  [a waiting job whose timestamp is 1e17] … the same lines, its start "by {"kind":"other"}"
  a record whose give-up time is past a Date's range: the snapshot should resolve; it rejected: Invalid time value
  … a Run: … status 500, not 200 …
FAIL  SWR85: the pass, with a job id that carries NUL: the spawn environment should carry no BRAINSTORM_TASK_JOB_ID
    when the id holds NUL … it carries "reconcileTaggingEdges\u0000x" …
  the pass, with a job id that carries NUL: no spawn environment value may hold NUL; these do: ["BRAINSTORM_TASK_JOB_ID"]
  another task, with a job id that carries NUL: … it carries "job\u00001" …; these do: ["BRAINSTORM_TASK_JOB_ID"]
FAIL  SWR86: the pass, with a job id of 201 characters: the spawn environment should carry no BRAINSTORM_TASK_JOB_ID
    when the id is longer than 200 characters (UTF-16 code units) — D10's pattern's bound, so no id can reach
    Linux's 128 KiB limit on one environment string (E2BIG) … it carries "reconcileTaggingEdges-aaaaaaaa"… (201 code units) …
  another task, with a job id of 201 characters: … it carries "job-11111111111111111111111111"… (201 code units) …
  another task, with a job id of 199 ASCII characters and one outside the BMP (201 code units): … it carries
    "job-cccccccccccccccccccccccccc"… (201 code units) …
```

SWR85's ordinary-id case passes on `2a361338`, so the recorder sees the variable when it is set. So do SWR86's
three cases of 200 code units.

**The tests can be met.** In a scratch copy of `2a361338` (`git archive`, so the checkout was not touched), the
round's three code fixes were patched in by hand:
- `waitForRun`, `signal` and the stop entry compare with `a.jobId`;
- `toIso` answers null for a time a Date cannot hold, and the stop entry's schedule start and the give-up line go
  through it;
- the processor leaves `BRAINSTORM_TASK_JOB_ID` out for an id that carries NUL.

Then pass-control was 73 / 0, wiring 85 / 0 (before SWR86 was added) and codes 54 / 0.

**SWR86 against the working tree.** With the code lane's first fixes in the checkout (the processor leaving the
variable out only for an id that holds NUL), wiring was 85 / 1 / 0, SWR86 failing with the lines above, and
pass-control 73 / 0 / 0. In a scratch copy of that working tree, with the processor also leaving the variable out
for an id longer than 200 characters (`jobId.length > 200`), wiring was 86 / 0 / 0. With that length fix in the
checkout, wiring is 86 / 0 / 0 and pass-control 73 / 0 / 0 (each suite alone through `run()`, Node 22.23.3).
