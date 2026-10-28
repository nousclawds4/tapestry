# ADR 0006: Running and stopping the pass: one serialised controller, a job id per start, an opt-in job gate, a signal to the exact process, and a private record of who

**Status:** Accepted (Amendment 1 appended 2026-10-28 — Stop's target keys are any 1 to 256 characters with no control
character; residual R9; the Implementer's as-built readings ratified)
**Date:** 2026-10-02 (re-read on 2026-10-27 against `48de58a7`, after merging `origin/staging`)
**Story:** `engineering-team/stories/tagging-edges/6-pass-run-and-stop.md`
**Amends:** ADR `tagging-edges/0002` (run, stop, the stopped outcome, who started a pass, the run-task route's answers
for this pass), with dated notes in ADRs `0003`, `0004` and `0005` (§ Amendments).

## Context

Story 6 gives the owner and admins **Run** and **Stop** for the gap-filling pass on story 4's panel. The panel also
shows every viewer which passes are waiting or running and whether a stop was asked for. It records who started or
stopped each pass. And it makes the general run-task route answer for this pass as Run does. Since 2026-10-10 that
route admits only the owner, an admin or a direct local call, for every task (§ Context, the routes and the gate). The
terms used below (Waiting, Running, Busy, Ended, Safe point, Action) are the story's.

### What exists (read at `bdcda39b`; re-read at `48de58a7` after the merge of `origin/staging`)

**The task queue** (`src/manage/taskQueue/queue/`):
- **One queue per task.** Each registry task has one BullMQ `Queue`, one `Worker` and one `QueueEvents`, named by the
  task. All of them run in the control-panel process, the same process as every API route (`index.js:102-142`;
  `bin/control-panel.js:333-348`).
- **Concurrency and the heavy-task cap.** The pass's worker runs one job at a time (concurrency 1). Its cap on
  `neo4j-heavy` work is 1 (`/etc/brainstorm-task-queue.json`).
- **Job ids, and silent joins.** `computeJobId` gives an on-demand job of a non-customer task the bare task name
  (`index.js:66-71`). Every Run-like start of this pass is therefore the job `reconcileTaggingEdges`, deleted when it
  ends (`removeOnComplete` and `removeOnFail`, `:192-202`).
  - BullMQ's add returns the existing job when that id exists. It hands back a `Job` built from the *caller's* data, so
    the caller cannot tell it joined (probe P2, below).
  - `runViaQueueAsync` answers `queued: true` either way (`:243-258`).
  - This is the cause of the silent join and of ledger row `2026-09-28-confirm-route-joins-finishing-job`.
- **Scheduled runs.** These come from Job Schedulers `sched:<entryId>`. Their jobs are `repeat:sched:<entryId>:<millis>`
  with data `{taskName, entryId, timeoutMs}` (`scheduler.js:36, :69-85`).
- **The heavy-task lock is taken inside the worker callback.** A tagged task takes its `neo4j-heavy` lease *inside* the
  Worker callback, before the processor spawns anything (`index.js:120-133`). The lease is a polled Redis hash:
  - one poll every 500 ms, giving up after 4 h with `RESOURCE_CLASS_WAIT_TIMEOUT`;
  - only lease ids and expiries are stored, never the holder;
  - no abort input (`resourceSemaphore.js:102-175`).

  So a pass waiting behind scoring is a BullMQ **active** job with no pass process.
- **The launch gap.** The processor spawns `launchChildTask.sh`, which starts the wrapper in the background. The
  wrapper takes `flock` on `pass.lock` and `exec`s node, so the pass's pid is the wrapper's (`processor.js:132-139`;
  `launchChildTask.sh:342-366`). The pass's first record appears about 250 ms after the lease is won.
- **The finishing window.** The job stays active for up to about 5 s after the pass exits, because the launcher polls
  every 5 s (`launchChildTask.sh:375`; measured 2.6–5.0 s).
- **No job information reaches the pass.** It gets no arguments, a generic environment and no job information
  (`taskRegistry.json:378-407`, pinned by SWR1–SWR5; `processor.js:136-138`).
- **Redis can hang a caller.** The queue's Redis client sets `maxRetriesPerRequest: null`, so while Redis is down a
  command waits in the offline queue forever. `isQueueAvailable()` pings and can hang with it (`index.js:48-53,
  :157-166`).
- **Nothing cleans up a heavy lease after a restart.** A backend restart leaves its lease for up to 4 h, and BullMQ
  re-runs the stalled job once with the same id and data (ADR 0002 :537-547).
  - **Where the stalled job sits.** BullMQ's stall check moves it from active back to wait after about 30–60 s.
  - **What the gate sees.** Until then it is active, and this process's gate has not seen it.

**The pass** (`src/pipeline/tagging-edges/reconcileTaggingEdges.js`):
- **Signals and safe points.** On SIGTERM or SIGINT it sets `stopRequested`. It checks the flag at five safe points:
  - before the claim (`:362`);
  - after the claim (`:381`);
  - after the graph read (`:413`);
  - after the relay read (`:429`);
  - before each write batch (`:533`).

  It then finishes `failed`, `reasonCode: 'signal'` (`stopNow`, `:306-311`).
- **The handlers are registered late and removed early.**
  - They are registered only after the pessimistic first save (`:239-256`).
  - `finish()` removes them before the final `save()` (`:278-283`). Once a signal's last listener is gone, Node's
    default action applies, and that action kills the process.
- **Nothing sends the pass a stop today.** Nothing in the app sends it SIGTERM or SIGINT. The time-out sends `kill -9`.
  A deploy SIGKILLs it when the container's PID 1 exits. There is no `process.kill` anywhere in `src/` or `bin/`.
- **Exit codes.** `exitCodeFor` gives 0 for `done`, `done-removals-held` and lock-busy; 2 for `refused` and for a
  start outside the lock; 1 for anything else (`:171-178`).
- **One writer for `report.json`.** The pass is its only writer. The public status serves `latest` and `previous`
  unchanged (`src/api/tagging-edges/index.js:105-119`).
- **The claim is atomic with the check before it.** Saving the `schema` phase (`:358`), the stop check at `:362` and
  the claim's rename (`claimConfirmation`, `state.js:199-226`) all run in one synchronous stretch. The claim is then
  saved, as `confirmation.found`, before the `graph-read` phase begins.

**The routes and the gate:**
- **`POST /api/run-task`** has no route middleware (`src/api/index.js:295`). Since 2026-10-10 the auth middleware gates
  it, for every task, to the owner's side: the owner, an admin or a direct local call.
  - **Where that was decided.** `security-auth-exposure` story 6 (PR #840). Since story 8 the route table holds it:
    `'POST /api/run-task': OWNER_ACTION` (`src/middleware/routeAccess.js:365`; ADR `security-auth-exposure/0005`).
  - **No handler check.** `handleRunTask` adds no who-check of its own.
  - **Refusals before any handler.** A signed-out POST gets 401 `{success: false, error: 'Sign in as the owner or an
    admin to do this.'}`. A signed-in session that is neither owner nor admin gets 403 `{success: false, error: 'Only the
    owner or an admin can do this.'}` (`src/middleware/auth.js:385-405`; `isOwnerOrAdmin`, `:277-285`). Neither carries
    `code` or `message`.
  - **Local calls.** A direct loopback call (a loopback peer with no forwarding headers) has `req.localTrusted` and
    skips every check, the table included (`:356-371`).
  - **No `Origin` check.** The middleware reads no `Origin`.
- **A route with no table entry** is the owner's side's: no match fails closed (`routeAccess.js:542-547`). The table is
  meant to be total (`:7-21`), and every tagging-edges route has an entry (`:439-445`).
- **`ownerOrAdmin(req, d)`** answers 401, then the role 403, then the cross-site 403 (`sameHost`), in that order
  (`src/api/tagging-edges/index.js:173-189`). Behind the auth middleware, which refuses a signed-out or non-owner/admin
  request first (`src/middleware/auth.js:400-405`), its 401 and role 403 are a re-check. The first refusal it gives an
  admitted session is the cross-site 403.
- **The confirm route's order.** It checks the latest report (409 `not-the-latest-report`, `:131-133`), then whether
  the held run's own process is alive (409 `running`, `:137-139`). It writes `confirmation.json` (`:307`), re-reads the
  report (`:313-327`), then enqueues (`:329-343`).
- **Story 5's precedents.** Its switch shows the patterns this story follows:
  - a module-level promise chain (`realtime.js:343-360`);
  - a record on the data volume with a gated GET (ADR 0005 D1–D6);
  - who never on a public route.

**What a signed-out reader can already see:**
- `/api/tagging-edges/status` serves the report whole.
- `/api/task-explorer/single-task/data` serves every `events.jsonl` line of the task, metadata included.
- `/api/task-watchdog/orphaned-processes` serves `ps aux` command lines.
- The semaphore's public events carry the job id.
- `/api/about-this-instance` serves the owner's key and every admin's full key. It has been public since 2026-10-13
  (ADR `about-this-instance/0001`, "Admins become public"; `src/middleware/routeAccess.js:74`).

**The panel.** It polls the status, the path status and the switch record every 5 s. It knows no role, and it sends
exactly one non-GET, `sendSwitch` (ADR 0005 D12; PS13, PS14, PS28). `PassSection` returns early for three states: no
body (`:151-159`), loading (`:160-162`) and an empty report (`:167-178`).

**Probes (2026-10-02, in the local container, against the installed BullMQ 5.76.10).** Each ran with its own key
prefix `probe6`, touched no app queue and no `taskQueue:resource-class:*` key, and was obliterated afterwards:
- **P1, id characters.** A custom id with `-` is accepted; one with a single `:` is refused ("Custom Id cannot contain
  :"). BullMQ lets a `:` through only when the id splits into exactly three parts (`bullmq/dist/cjs/classes/job.js:1043-1045`).
- **P2, a re-add joins silently.** With job A active, a job added under a new id goes to `wait`. A re-add of A's id
  returns A's id, with the caller's data on the returned object and A's data stored.
- **P5, an active job cannot be removed.** `queue.remove` of the active, locked job answers 0, and `job.remove()`
  throws "locked by another worker".
- **Q2, a run that comes due while another job is active.** It stays in `delayed`, past due. `queue.remove` on it
  throws "belongs to a job scheduler and cannot be removed directly".
- **Q3, the schedule keeps its time.** When that job is picked up and its processor returns at once, the scheduler's
  next run is the usual slot (`next` moved from …401165 to …404165, every 3000 ms).

### Constraints

- **Everything the story says.** In particular:
  - no gap between waiting and running;
  - a stop acts only on what its prompt showed;
  - a Stop takes effect when it cannot be recorded, while a Run is refused;
  - a request that lines up no new pass records nothing;
  - who never reaches a signed-out reader;
  - schedules never change;
  - the run-task route answers for this pass as Run does, and other tasks are unchanged.
- **What "who" means for privacy.** In AC-2's and AC-5's privacy rule, "who" means:
  - an owner's or admin's key;
  - which of the owner, an admin, a local call or the owner's confirmation made a start through the app.

  Those four stay indistinguishable to a signed-out reader. A BullMQ job id's form was already public before story 6
  (the semaphore's events carry it), and the public status and report keep it. That form can show two things:
  - that a run was scheduled (`repeat:sched:…`);
  - that it was not lined up through the app's routes (an id that is neither `LINEUP_ID`'s shape nor
    `repeat:sched:…`).

  One more thing can show while the record cannot be written. `startRecorded: false` on a `LINEUP_ID` key shows that
  the start was not a Run or a local call. It was the confirmation, an R1 landing, or a start read while the record was
  unreadable. The confirmation's timing is already public through `confirmationPending`.

  **The set of keys is public** (§ Context: `/api/about-this-instance`). What stays private is which key, or which kind,
  took an action. The public status narrows it only to that set:
  - only the owner or an admin reaches Stop (D9), so on an instance with no admins, a stop asked for was the owner's;
  - a start with `LINEUP_ID`'s shape was then the owner's, a local call's or the confirmation's.

  AC-2 lets the public status say that a stop was asked for, and when, and this ADR keeps that.
- **Shared queue code changes only by opt-in.** `index.js`'s worker callback, `resourceSemaphore.js` and `processor.js`
  serve all 29 `neo4j-heavy` tasks and every other task. Changes there must leave every other task's behaviour
  unchanged. They must also keep the source pins:
  - T1–T3 (`enqueueTask`, `computeJobId`; T3 now pins the customer form `` `${taskName}-${pubkey}` ``);
  - V1–V3 (`test/task-queue-jobid-valid.test.js`: every computed id passes BullMQ's own check);
  - T7/T8 (the semaphore tokens);
  - R2 (`processJob` exported);
  - R3/T12/T13 and R1 (run-task literals);
  - R4 (the pgrep guard);
  - kill-timeout-orphans-by-default R3 and scheduled-task-timeout-propagation R1/R2, which pin the worker wrap's
    `semaphore.acquire(`, its `finally … release()` and the phase tokens. They hold under D3 and D4.
- **The real-time path is not touched** (ADR 0003 binding 4). It reads only `runId`, `startedAt`, `endedAt` and
  `process` from `report.json`, so a stopped pass that ends through `finish()` still gets its catch-up.
- **`report.json` keeps one writer (the pass) and holds only real runs.** A waiting pass, or one taken out of line,
  writes no report (ADR 0002 decision 15).
- **Who never goes anywhere a signed-out reader can see:**
  - `report.json`;
  - `confirmation.json`;
  - `events.jsonl` metadata;
  - process arguments;
  - job ids and job names;
  - `scheduled-tasks.json`.

  It also stays out of job data, which BullBoard can patch and a stalled job re-runs with (ADR 0002 D8).
- **No new timer in the panel.** The 15 s race stays in `taggingPipelineFetch.js`, and the view module stays clock-free
  (ADR 0005 § Constraints).
- **Principle 4.** Nothing here writes or deletes graph state. A Stop ends a pass at a safe point, and what it wrote
  stands.

## Options considered

### Option A: a server-side controller with a job id per start, an opt-in job gate in the worker, a signal for a running pass, and a private record (chosen)

**The controller.** A module in the control-panel process owns three things:
- one promise chain;
- the in-memory marks;
- the action record on the data volume.

These join the chain:
- every start this story owns (Run, the run-task route for this pass, the confirm route's enqueue);
- every Stop;
- the worker's per-job decisions.

**Starts.** Each start adds a job under a new, opaque id (`reconcileTaggingEdges-<12 hex>`). Nothing ever joins.

**The gate.** The pass's worker callback consults a gate (opt-in by task) at three points: before the heavy-lock wait,
at every lock poll, and after the lock is won.
- **A stopped waiting job** completes without spawning.
- **A stopped running job** is never re-run after a restart, when the stop was recorded (R2).

**A running pass.** It is stopped by SIGTERM to the pid in `report.latest.process`, checked against its job id and
start time just before the signal. The pass's handler now lasts from just after its lock checks to the end of
`finish()`, so any pid the server can see is guarded.

**The pass learns its job id from the environment** and writes it into its report. The server then joins a run to who
started and stopped it through a private record served only by a gated GET.

**The public status** gains a who-free busy list computed by the server.

- **Pros.**
  - Each moment the story cares about is decided in one place, in one process, in one order: lined up; skipped;
    launched (waiting→running); asked to stop.
  - Stop needs no disk, so a Stop still takes effect when it cannot be recorded.
  - The finishing window can no longer swallow a start, for Run and the confirm route alike.
  - Due scheduled runs are skipped at pickup, which leaves the schedule's next run unchanged (probe Q3).
- **Cons.**
  - Touches shared queue code (opt-in by task), the processor (one environment value for every task) and the pass.
  - The public status reads Redis for the first time, so the reads must be bounded.
  - In-memory marks need a persisted copy to survive a restart.

### Option B: pass-side control files (stop requests the pass polls, a ticket it claims at step 3)

How it would work:
- **A running pass.** The route writes `stop/<runId>.json`, and the pass reads it at each safe point.
- **The waiting→running boundary.** This becomes the pass claiming a per-job ticket by rename before its pessimistic
  write. A Stop that wins the rename makes the pass exit with no report, like `--lock-busy`.

- **Pros.** The boundary is atomic on disk and survives restarts. Who and when travel with the request. No signal is
  sent, so pid reuse cannot arise.
- **Cons.**
  - Delivery needs a disk write, so on a full volume the Stop does not happen. That breaks AC-5's "a Stop still takes
    effect".
  - A pass waiting behind scoring has no process to read anything, so the worker change of option A is needed anyway.
  - It adds a new check point before the pass begins running, plus more pass-side ports and pruning, and a stale
    request must never reach a later pass.

Rejected: it does not remove option A's worker change, and it loses a requirement.

### Option C: BullMQ's own tools (keep the fixed id with a nonce readback, `Worker.cancelJob`, `job.remove`)

How it would work:
- **Starts** keep the shared id. A join is detected after the add by reading back a server nonce.
- **A pass waiting behind the lock** is cancelled through `Worker.cancelJob` and a three-argument processor's
  `AbortSignal`.
- **A waiting job** is removed with `job.remove`.

- **Pros.** Uses supported library features. No new job ids.
- **Cons.**
  - `cancelJob` is in-process only and lost on a restart, after which the stalled re-run starts the stopped pass.
  - The workers map is private.
  - `remove` fails for both waiting cases: a due scheduled run (probe Q2) and an active job (probe P5).
  - The fixed id still joins in the finishing window, so the readback can only refuse there, not line up truthfully.

Rejected.

## Decision

We chose **option A**. It is the only option that decides every transition the story names in one serialised place,
keeps a Stop working without disk, and leaves schedules untouched. Its costs are known and bounded:
- **Shared code** changes behind a per-task opt-in.
- **The public status** reads Redis once per poll: up to four reads under one 2 s deadline. The first failure or
  time-out ends them (D5).
- **In-memory marks** are mirrored to the data volume.

## Consequences

**Enables:**
- Run and Stop for the owner and admins.
- Waiting and stopping states that every viewer sees.
- A stopped pass that reads as its own outcome, with who and when for the owner and admins.
- The run-task route answering as Run does for this pass.
- **The confirm route's enqueue goes through the same start function** (D8), which closes ledger row
  `2026-09-28-confirm-route-joins-finishing-job` in this story. Story 7 checks it, as the story's Out of scope allows.
- **A pass that was asked to stop is never started again by a stalled re-run after a restart,** when the stop was
  recorded. The `noRerun` mark is per job (D9).

**Constrains:**
- **Every start of this pass from app code goes through the controller.** A new caller must use `lineUp`, never
  `enqueueTask` or `runViaQueueAsync`.
- **The gate is the only place that decides whether this task's job runs.**
- **The public status now depends on Redis.** It must keep serving the report when the queue read fails, and say "cannot
  tell".

**Residuals:**
- **R1.** A queue add that times out while Redis is unreachable can still land when Redis returns. The key is skipped
  in memory (D6), so it completes without spawning. Only a backend restart before it is picked up lets it run. That
  pass then shows its start as not recorded.
- **R2.** A Stop whose record write fails keeps its effect only in memory. Two cases follow a backend restart:
  - **A waiting job.** If the restart comes before the skipped job is picked up, that job runs.
  - **A running pass.** If the restart comes before its stalled job is re-run, the re-run is not skipped, and starts a
    new pass.
- **R3.** BullBoard's own actions (add, remove, promote, retry) bypass the controller, which is out of scope. The read
  model tolerates jobs appearing or vanishing. An add made there shows as "started another way".
- **R4.** "Behind other heavy database work" cannot name the holder, because the lease stores none. A lease leaked by a
  restart reads the same.
- **R5.** "Queue unavailable" and "cannot tell" cannot be shown live with a signed-in viewer: the session store shares
  Redis and fails the request first. They are proven with injected deps and browser mocks.
- **R6.** An operator's manual SIGTERM or SIGINT now also reads as "stopped on request", with who not recorded.
- **R7.** A job with the legacy fixed id `reconcileTaggingEdges` can still exist after the deploy: a stalled job from
  before it, or a BullBoard add. The gate records its start as `{kind: 'other'}` at pickup, so its run reads "started
  another way" (or "start not recorded" if that write failed). The server cannot tell the two origins apart. It can
  still be stopped (D9 compares job ids, not keys).
- **R8.** Since 2026-10-13 the owner's and every admin's keys are public (`/api/about-this-instance`). The public
  `stopAskedAt` therefore narrows who pressed Stop to that set. On an instance with no admins, it says the owner did.
  AC-2 allows the public status to say that a stop was asked for, and when, so this ADR keeps it.
- **R9.** *(Amended 2026-10-28: a busy job a Stop cannot name; see Amendment 1 § B.)*

**Debt and follow-ups:**
- The ledger row above closes here; story 7 re-checks it from the panel.
- **OPERATIONS §10.6** (`:578`) says a job whose heavy-lock wait timed out stays in BullBoard's failed tab. That holds
  only for scheduled runs; on-demand jobs carry `removeOnFail` and are deleted (docs task).
- A pre-existing, separate defect was found while probing: per-customer job ids contained `:`, which BullMQ 5.76.10
  refuses. It was fixed outside this story.
  - **The fix.** `computeJobId` now gives `` `${taskName}-${pubkey}` `` (`queue/index.js:66-71`; ADR `assistant-scores/0001`
    Amendment 1; ledger `2026-10-14-run-task-customer-jobid-rejected`, DONE).
  - **This story.** The pass takes no customer arguments, so nothing here depends on it.

**Firmware reinstall required?** No. No concept definition changes.

## Implementation notes

All line numbers are at `48de58a7` (after the merge of `origin/staging`); prefer the named functions if they have moved.
- **"The controller"** means the new `src/pipeline/tagging-edges/control/` (D1).
- **"The routes"** means the new `src/api/tagging-edges/pass.js`. Its one `defaultDeps` serves every handler in it,
  and must include `getAdminPubkeys` (the SWR74 trap).

### Server

**D1. The controller module, its state and its chain.**
- **Files.** New directory `src/pipeline/tagging-edges/control/`:
  - `index.js`: the chain, the in-memory state, `lineUp`, `stop`, `snapshot`;
  - `gate.js`: exports `makeGate(state, deps)`, a factory that `createController` calls to build the worker gate (D3).
    It holds no state of its own;
  - `store.js`: the record, D11.
- **Requires.** The controller requires no route module. It requires the queue module only lazily, through deps, so
  `queue/index.js` can require the gate at init without a cycle.
- **One instance.** `control/index.js` exports `createController(deps)`. It returns
  `{lineUp, stop, snapshot, gate: {beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp, skipped}}`, with the
  chain, all marks and the status cache on the instance.
  - **The default instance.** The module also exports `controller`, one instance built from `defaultDeps`. `pass.js`,
    `index.js` (`d.lineUp`, `d.snapshot`) and `jobGates.gateFor` all use it, so the routes and the worker share one
    state.
  - **Tests** build their own instance with injected deps and timers.
- **The chain.** `let chain = Promise.resolve()`, as in `realtime.js:343-360`. Every step runs as
  `step = chain.then(fn); chain = step.catch(() => {})`.
- **Refusals happen outside the chain.** Auth, body validation and the queue's being off are answered before joining.
- **Every Redis call inside a step is bounded.**
  - First check `d.queueHealth()` (D2), which issues no command.
  - Then race the call against a deadline. The snapshot's reads share one deadline, `REDIS_STEP_MS = 2000`, and each
    read gets what is left of it. An add gets its own 2000 ms.
  - A time-out or a throw counts as "cannot tell" for that step, never as "nothing there".
- **In-memory state**, keyed by the D2 job key unless said otherwise:
  - `phases`: `Map(key → {jobId, phase: 'waiting-for-lock' | 'launched', since})`, written only by the gate;
  - `endedKeys`: `Map(key → endedAt)`, filled by `gate.ended`, entries dropped after 10 s;
  - `skips`: `Set(key)`, waiting jobs taken out of line, read by D5 and by the gate;
  - `noRerun`: `Set(key)`, jobs whose running pass was asked to stop. The gate reads it (`beforeAcquire`,
    `shouldAbandon`, `afterAcquire`). D5 reads it only to drop executions other than the live pass;
  - `stopsAsked`: `Map(key → {at, runId|null})`;
  - `linedUp`: `Set(key)`, every key `lineUp` added or tried to add;
  - `lastGaveUp`: `{key, at}` or null;
  - `record` and `recordState`: the last record read or written, and whether it was readable (D11), loaded lazily from
    disk on first use;
  - `generation`: a counter that every state-changing step bumps (D5).

**D2. A job id per start, and the job key.**
- **The id.** `lineUp` adds with `jobId = 'reconcileTaggingEdges-' + randomBytes(6).toString('hex')`. It is opaque and
  matches `LINEUP_ID = /^reconcileTaggingEdges-[0-9a-f]{12}$/`; it has no `:`, which BullMQ refuses in a custom id unless the id splits into exactly three parts (probe P1). The data
  is `enqueueTask`'s shape: `{taskName, customerArgs: null, queryParams: undefined, timeoutMs}`. The options are
  `{jobId, removeOnComplete: true, removeOnFail: true}`. The job name is the task name.
- **How it adds.** Through the exported `getQueue('reconcileTaggingEdges').add(...)`, bounded. `enqueueTask`,
  `computeJobId` and `runViaQueueAsync` stay byte-identical to `48de58a7` (T1–T3, V1–V3). The customer separator has
  been `-` since ADR `assistant-scores/0001` Amendment 1.
- **The job key** is `job.id`. The one exception is a job with the legacy fixed id `reconcileTaggingEdges` (R7), whose
  key is `` `${job.id}@${job.timestamp}` ``. That id is reused, and a stalled re-run keeps its timestamp.
- **"The id's millis"** means the digits after a scheduled job id's last `:`. The entry id may itself contain `:`:
  the seed backstop's job ids are `repeat:sched:seed:reconcileTaggingEdges:<millis>`.
- **`jobIdOf(key)`** returns the key unchanged, except for a legacy key, where it returns `reconcileTaggingEdges`.
  Every comparison with a report's `job.id` uses `jobIdOf`, never the key.
- **A new export in `queue/index.js`.** `queueHealth()` returns `'off'` when `_state` is null, `'ready'` when
  `_state.redis.status === 'ready'`, and `'not-ready'` otherwise. It issues no Redis command. The existing exports stay.

**D3. The job gate: opt-in, in the worker callback.**
- **The opt-in.** New file `src/manage/taskQueue/queue/jobGates.js` exports
  `gateFor(taskName) → gate | null`. It returns the default controller's gate,
  `require('../../../pipeline/tagging-edges/control').controller.gate`, for `'reconcileTaggingEdges'`, and null for
  every other task. `initTaskQueue` resolves it once per task, when it builds that task's worker.
- **The worker callback.** For a task whose gate is null the callback is today's, byte for byte. With a gate, the
  `resourceClass` branch is:

  ```js
  async (job) => {
    let release = null;
    try {
      if ((await gate.beforeAcquire(job)) === 'skip') return gate.skipped(job);
      try {
        release = await semaphore.acquire(resourceClass, {
          taskName,
          target: (job && job.data && job.data.customerArgs && job.data.customerArgs.pubkey) || '',
          jobId: job && job.id,
          shouldAbandon: () => gate.shouldAbandon(job),
        });
      } catch (err) {
        if (err && err.code === 'RESOURCE_CLASS_WAIT_TIMEOUT') await gate.gaveUp(job, err);
        throw err;
      }
      if (!release) return gate.skipped(job);
      if ((await gate.afterAcquire(job)) === 'skip') return gate.skipped(job);
      return await processor.processJob(job, taskDef);
    } finally {
      if (release) await release();
      gate.ended(job);
    }
  }
  ```

  - `gate.skipped(job)` returns `{skipped: true, jobId: job.id}`, so the job completes and, for on-demand jobs, is
    removed.
  - `gate.ended` is synchronous and in memory, never a chain step.
  - A give-up still fails the job, as today.
  - The T7/T8 tokens all remain.
- **`beforeAcquire`** (in the chain):
  - **Skip marks.** If the key is in `skips` or `noRerun`, or the record's entry has `skip` or `noRerun`, answer
    `'skip'`.
  - **A scheduled job** (id starts `repeat:sched:`) with no start in the record: record the start as
    `{kind: 'schedule'}`, `at` = the id's millis. A schedule's start cannot be refused, so a failed write goes ahead
    unrecorded.
  - **Another job the record does not know:** record the start `{kind: 'other'}` at `job.timestamp`, best effort. This
    applies to a key that does not match `LINEUP_ID` and is not in `linedUp`. A `lineUp`-made key with no start (its
    record write failed) stays unrecorded, as AC-5 requires.
  - Then set `phases[key] = {jobId: job.id, phase: 'waiting-for-lock', since: now}` and answer `'go'`.
- **`shouldAbandon`** is synchronous: `skips.has(key) || noRerun.has(key)`. `noRerun` matters here only for a stalled
  re-run, after a backend restart, of a job whose orphaned pass was stopped while this re-run waited.
- **`afterAcquire`** (in the chain): if the key is in `skips` or `noRerun`, answer `'skip'`. Otherwise set
  `phases[key] = {jobId, phase: 'launched', since: now}` and answer `'go'`.

  This chain step **is the waiting→running boundary.**
  - **Stop first.** A Stop step that ran before it saw the pass as waiting and put it in `skips`, so this step skips
    it.
  - **This step first.** A Stop step that runs after it sees the pass running (starting). It then refuses a prompt that
    said waiting (D9).
- **`ended`**:
  - delete `phases[key]`;
  - set `endedKeys[key] = now`;
  - drop the in-memory `skips` and `noRerun` for the key, since the record keeps both;
  - bump `generation`.
- **`gaveUp`**:
  - set `lastGaveUp = {key, at: now}`;
  - record `gaveUpAt` on the job's entry, best effort;
  - bump `generation`.
- **What the gate does not decide.** It never reads Redis. It records no who for an owner, admin, local or confirmation
  start, because those are recorded by `lineUp` before the add.

**D4. The semaphore's abandon hook.**
- **The option.** `acquire(resourceClass, context)` honours an optional `context.shouldAbandon`:
  - **at the top of each loop pass**, before `semaphoreAcquire`: if it answers true, emit `resource_class_wait_end`
    with `outcome: 'abandoned'` (only if `wait_begin` was emitted) and return `null`;
  - **after a winning `semaphoreAcquire`**, before the `wait_end acquired` event: if it answers true, `HDEL` the lease
    just won, emit `abandoned`, and return `null`.
- **Unchanged without it.** With no `shouldAbandon` the function is unchanged and never returns null.
- **Why inside the loop.** Abandoning from outside, by racing the promise, would leave the loop polling and later
  leak a lease for 4 h.
- **No who.** The `abandoned` event carries the same fields as the others: task name, class and job id.

**D5. The busy snapshot.**
- **What it is.** One function, `snapshot(d, {fresh})`, serves the public status, Run, Stop and the confirm route. It
  reads, in this order:
  0. `confirmation.json` (`readConfirmation`), for D12's verdict;
  1. `report.json`, and the liveness of `latest.process`;
  2. the in-memory state;
  3. if `queueHealth()` is `'ready'`, four bounded reads in this order:
     - `getActive()`;
     - `getDelayed()`;
     - `getJobs(['waiting', 'paused', 'prioritized'])`, because `getWaiting` alone covers only wait and paused;
     - `getActive()` again.

  - **Every move is seen at least once.** A move in either direction (delayed→wait→active, or a stall from active back
    to wait) shows up in at least one read. Jobs are deduped by id, keeping the later state.
  - **The first failure ends the reads.** The first read that fails or times out ends the poll's Redis reads, with
    `queue: 'read-failed'`, and the rest are not issued.
  - **Missing jobs** (undefined entries) are dropped.
  4. for each running item with a `runId`, `listClaimed(runId)`.

  It computes D12's confirmation verdict from these reads. The verdict is cached and served with the snapshot.
- **`queue`** is `'ok'`, `'off'` (`queueHealth` off), `'not-ready'`, or `'read-failed'` (a throw or a time-out).
- **Liveness comes first.** A live `latest` (`endedAt` null, `isAlive`) is a `running` item, whatever the queue read
  found. Its key is, in order:
  1. the key of the read active job whose id equals `latest.job.id`, when that job's `processedOn` is not after
     `latest.startedAt` (this keeps legacy keys working);
  2. otherwise `latest.job.id`, when it is present, matches D10's pattern, is not the legacy id, and no read job
     carries that id (a stalled re-run of the same job would);
  3. otherwise `` `run:${latest.runId}` ``. This is a pass orphaned by a restart, a hand run, a legacy id, or an
     orphan whose own job is being re-run.

  The item is `{key, jobId: latest.job.id || null, state: 'running', since: latest.startedAt, runId: latest.runId}`.
  An active job matched in this step is not classified again.
- **Classifying the other jobs.** A job whose key is in `skips` or `noRerun`, or has the record's `skip` or
  `noRerun`, is dropped.
  - **The live pass is never hidden by `noRerun`.** It is matched first, under "Liveness comes first", and stays listed
    until it ends.
  - **Any other execution of a `noRerun` key** (a stalled job from before a restart) is skipped at `beforeAcquire`,
    `shouldAbandon` or `afterAcquire`, so it is never busy.

  For each remaining job:
  - **Due-delayed, wait, paused or prioritized** (a delayed job whose `timestamp + delay <= now`; not-yet-due delayed
    jobs are ignored) → `waiting`.
    - `since` is the id's millis for a scheduled job, else `job.timestamp`.
    - `behind` is `'pass'` when another job of this queue is active or a pass is alive, else null.
  - **Active, with phase `waiting-for-lock`** → `waiting`, `since` as above, `behind: 'heavy-work'`.
  - **Active, with phase `launched`:**
    - if `latest.job.id === phases.jobId` and `latest.startedAt` is no earlier than `phases.since`, and that run has
      ended (`endedAt` set, or not alive) → the job is **ending** (the finishing window): not busy, and not listed. A
      live one already matched under "Liveness comes first";
    - else, if the key is in `endedKeys` → ending;
    - otherwise → `running`, starting: `since: phases.since`, `runId: null`.
  - **Active with no phase.** This process's gate has not yet seen this execution. Either it is a pickup whose
    `beforeAcquire` is queued in the chain, or it is a stalled job left by a restart, which BullMQ will run again.
    - In `endedKeys` → ending.
    - Otherwise → `waiting`, `since` as above, `behind: null`.
- **`stopAskedAt`** comes from `stopsAsked` or the record under the item's key. For a running item, it falls back to a
  `stopsAsked` value or a stop entry with the same `runId`.
  *(Amended 2026-10-28: an in-memory mark counts for its own execution only; see Amendment 1 § C.)*
- **Each item** is `{key, jobId, state, since, behind, runId, stopAskedAt}`. Items are sorted running first, then
  waiting by `since`.
- **Busy** means `items.length > 0`. When `queue !== 'ok'`, only the liveness item is known, and the panel says it
  cannot tell whether a pass is waiting.
- **Caching, for the status route only.**
  - `handleStatus` may reuse a snapshot computed in the last 1000 ms, if it carries the current `generation`.
  - Every state-changing step bumps `generation`:
    - `lineUp`'s add, and its failure path;
    - the confirm route's chain step, on every path, the joined answer included;
    - `stop`'s marks and signals;
    - the gate's phase, skip, ended and gave-up changes.
  - A cached or in-flight status snapshot from an older generation is neither served nor stored.
  - `lineUp`, `stop` and the confirm route always call `snapshot(d, {fresh: true})` inside their chain step.

**D6. Run: `lineUp({who, mode: 'run'})`.**
- **Mounted** as `app.post('/api/tagging-edges/pass/run', adminApi.requireOwnerOrAdmin, handlePassRun)`, keyed
  `OWNER_ACTION` in the route table (D13).
  - **The handler's checks.** It re-checks `ownerOrAdmin(req, d)` (401, role 403, cross-site 403), then requires JSON
    (415). The body is `{}`; anything else is 400.
  - **The middleware comes first.** It refuses a signed-out caller with 401 and a signed-in stranger with 403, before
    the guard and with its own text.
- **Every exported `pass.js` handler resolves and never rejects.** After the pure who and body checks, everything that
  calls a dep (the queue checks included) runs inside the handler's `try`/`catch`. The `catch` answers 500 with
  `{code: 'error', cause: allowErrorCode(err && err.code)}`, as `realtime.js:352-370` does.
- **Off-queue refusal, outside the chain.** If `taskQueueEnabled()` is false, or `queueHealth() !== 'ready'`, answer
  503 `{code: 'QUEUE_UNAVAILABLE'}`. Nothing changes.
- **In the chain**, in this order:
  1. `snapshot` (fresh). If `queue !== 'ok'` → 503 `QUEUE_UNAVAILABLE`. If busy → 409
     `{code: 'pass-busy', busy: items}`; the items carry no who.
  2. **The record first.** Create the key (D2) and add it to `linedUp`. Write the record, with the start entry and its
     history line (D11).
     - If the record is unreadable, or the write fails → 500 `{code: 'record-unavailable'}`. Nothing has been added.
  3. **Then the add** (bounded). If it fails or times out:
     - put the key in `skips`, so a late landing completes without spawning (R1);
     - remove the start entry and its history line (the line whose key is this key) in one best-effort write;
       *(amended 2026-10-28: the record as it was just before the start's own write; see Amendment 1 § C)*
     - answer 503 `QUEUE_UNAVAILABLE`, or 500 `{code: 'error', cause}`.
  4. Bump `generation` and answer 200 `{success: true, linedUp: true, key, recorded: true}`.
- **The finishing window.** A Run in that window is not busy (the ending job is not listed). It lines up a new job,
  which waits up to about 5 s behind the ending one and then runs. Its answer is therefore true.

**D7. The run-task route for this pass.**
- **The branch.** In `handleRunTask` (`runTask.js:361-369`), right after `const { taskName } = req.query;`, add one
  line: if `String(taskName) === 'reconcileTaggingEdges'`,
  `return await require('../../tagging-edges/pass').handleRunTaskForPass(req, res);`.

  `String()` makes a repeated or bracketed query parameter compare the same. `return await` keeps any rejection inside
  `handleRunTask`'s `try`, although the delegate never rejects (D6). Every other task, and every existing literal (R1,
  R3, T12, T13), is unchanged.
- **`handleRunTaskForPass(req, res, deps)`** works in this order:
  - **Who.** `req.localTrusted` gives `{kind: 'local'}`. Otherwise `ownerOrAdmin(req, d)` gives `{kind: role, key}`,
    or its 401 or 403.
    - **Through the app this is a re-check.** The auth middleware has already refused a signed-out caller (401) and a
      signed-in stranger (403), for every task (§ Context).
    - **What it adds.** It supplies the role and key. Its own 401 and role 403 answer only where the two checks
      disagree: an owner key that `OWNER_RE` rejects, or injected deps.
  - **`sameHost`** applies to a local call too; a local call normally sends no `Origin`. No JSON is required, because
    the Task Explorer posts no body. For a real request, this is the one who-or-where refusal the branch adds, because
    the middleware reads no `Origin`.
  - **Then** the queue checks and the same chain step as D6.
- **Its answers** carry `message` for the Task Explorer's modal, beside `error` and `code`:
  - 200 `{success: true, message: 'A gap-filling pass was lined up.', queued: true, jobId: key}`;
  - 409 `{success: false, code: 'pass-busy', error, message: 'A pass is already waiting or running. Nothing new was
    lined up.'}`;
  - 503 `QUEUE_UNAVAILABLE`, 500 `record-unavailable`, and the delegate's own 401 and 403 (the cross-site 403 among
    them), each with a `message`.
  - **Who never reaches the delegate.** A signed-out caller or a signed-in stranger is answered by the middleware:
    `{success: false, error}`, with no `message` (`src/middleware/auth.js:400-405`). The Task Explorer's modal therefore
    shows "Task failed" (`public/pages/manage/task-explorer.html:1953`, `task.html:1544`).
  - **Left as it is.** That holds for every task, and `test/admin-action-sweep-access.test.js` AC7 pins the shape, so
    this story leaves it.
- **With the flag off** this pass is refused, 503 `QUEUE_UNAVAILABLE`. It no longer takes the legacy direct spawn, which
  bypassed the queue and the heavy-task lock.

**D8. The confirm route's enqueue: `lineUp({who: {kind: 'confirmation'}, mode: 'confirm'})`.**
- **What changes.** In `handleConfirmHeldRemovals` (`index.js:329-343`):
  - the `d.isQueueAvailable()` guard becomes `d.queueHealth() === 'ready'`;
  - `d.runViaQueueAsync(...)` becomes `d.lineUp(...)`;
  - `index.js`'s `defaultDeps` gains `queueHealth`, `lineUp` and `snapshot`, all from the default controller.

  The answer keeps today's members `{success, confirmed, enqueued, expiresAt, jobId?}`, and may add `joined`.
- **Busy with any item that has no stop asked for** (waiting; starting; or running): add nothing and record nothing.
  Answer `enqueued: true, joined: true`.
  - **A running pass here** can only be one whose first record was written after the route's re-read (`:313`). It
    therefore reaches its claim (step 7) after the confirmation was written, and takes it up.
  - **A pass already running before the write** is refused earlier, 409 `not-the-latest-report` (`:131-133`).
  - **409 `running`** is only the held run's own process, still alive in its finishing window.
- **Busy only with passes that have a stop asked for**, or not busy (the finishing window included): line up a new job,
  record the start `{kind: 'confirmation'}`, and answer `enqueued: true, jobId`. The confirm route's start cannot be
  refused, so an unreadable record or a failed write goes ahead unrecorded.
- **Queue not ready**, or the chain step's fresh snapshot has `queue !== 'ok'`: add nothing, record nothing, and
  answer `enqueued: false`. The confirmation stays pending for the next pass, as today.
- **An add that fails or times out**: put the key in `skips`, remove any start entry and history line already written
  (as D6 step 3), and answer `enqueued: false`.
  *(Amended 2026-10-28: the take-back is D6 step 3's, as amended; see Amendment 1 § C.)*
- **The ledger row** closes here (§ Consequences).

**D9. Stop: `stop({who, targets})`.**
- **Mounted** as `app.post('/api/tagging-edges/pass/stop', adminApi.requireOwnerOrAdmin, handlePassStop)`, keyed
  `OWNER_ACTION` in the route table (D13). The handler
  re-checks `ownerOrAdmin`, then requires JSON (415), then validates the body (400). The body is
  `{targets: [{key, state: 'waiting' | 'running'}]}`: one to fifty entries, distinct keys, each key at most 120
  characters of `[A-Za-z0-9:._@-]`.
  *(Amended 2026-10-28: a key is now 1 to 256 characters with no control character, see Amendment 1 § A; and the
  busy jobs a Stop cannot name are residual R9, § B.)*
- **In the chain:**
  1. **`snapshot`** (fresh). If `queue !== 'ok'` and any target is not the snapshot's liveness item, answer 503
     `QUEUE_UNAVAILABLE`. Nothing changes.
  2. **Compare.** Let `open` be the snapshot's items with no `stopAskedAt`.
     - **Stale prompt.** Any target found in `open` with a different state, or any `open` item missing from the
       targets, makes the prompt out of date: 409 `{code: 'prompt-out-of-date', busy}`.
     - **Nothing left.** A target missing from `open` (it ended, or already has a stop) is left out. If none is left,
       answer 409 `{code: 'nothing-to-stop'}`.
  3. **Running targets first**, so a refusal changes nothing.
     - **No pid yet.** A target with no `runId` (starting) is waited for: up to `PID_WAIT_MS = 3000`, re-reading
       `report.json` every 100 ms for a live `latest` whose `job.id === jobIdOf(key)`. When `phases[key]` exists, its
       `startedAt` must also be no earlier than `phases[key].since`.
     - **The wait ends early in two cases:**
       - **Already ended.** A record for this execution shows it has ended: `job.id === jobIdOf(key)`, `startedAt` no
         earlier than `phases[key].since`, and `endedAt` set or not alive. The target is too late. It goes on to step
         4 with `how: 'too-late'`: its stop is recorded, with that record's `runId`, and no signal is sent.
       - **Ended with no report.** The key reaches `endedKeys` with no such record (the job ended without writing a
         run). The target is left out, as in step 2. If no target is left, answer 409 `nothing-to-stop`.
     - **If neither happens within `PID_WAIT_MS`**: 409 `{code: 'pass-not-reachable'}`. Nothing changes.
  4. **Act.** For each target:
     - **First, the effect in memory.**
       - A waiting target goes into `skips`.
       - A running target goes into `stopsAsked` (with its `runId`) and into `noRerun`, under its job's key. It never
         goes into `skips`, which would hide it from the busy list while it still runs.
       - **A `run:` target.** Its `stopsAsked` and its stop entry go under `run:<runId>` itself, with `jobId` set to
         the report's `job.id` or null. When its report carries a non-legacy job id, only `noRerun` goes under that
         id, in memory and as `noRerun: true` on that id's entry.
     - **Then the record** (D11):
       - a stop entry per target;
       - `skip` on a waiting target's entry, `noRerun` on a running target's;
       - for a due scheduled job with no start yet, its schedule start, at the id's millis.

       A failed or refused write leaves the effect in place and sets `recorded: false`.
     - **Then the signal, for each running target:**
       - re-read `report.json`;
       - require `latest.job.id === jobIdOf(key)` (or `latest.runId` for a `run:` key), the same `startedAt` rule as
         step 3, `latest.endedAt == null`, and `state.isAlive(latest.process)`;
       - then `process.kill(pid, 'SIGTERM')`.

       If the pass has ended by then, or `kill` throws `ESRCH`, the stop came too late. The record keeps the stop, and
       the panel shows it as too late (D18).

       Never signal a process group, the launcher's bash or SIGUSR1.
  5. Bump `generation`, and answer 200
     `{success: true, stopped: [{key, how: 'taken-out-of-line' | 'asked-to-stop' | 'too-late'}], recorded}`.
- **A waiting target's effect.** The job leaves the busy list at once, because the snapshot drops skipped keys, so
  every viewer sees it gone within one 5 s poll. Its job then completes without spawning:
  - at its next lock poll, within 500 ms, through `shouldAbandon`;
  - or when it is picked up;
  - or at `afterAcquire`.

  A due scheduled run's next run stays at its slot (probe Q3). The skip is per job, so a pass that lines up after the
  stop is not covered.
- **A running target's effect.** The pass stays listed as running, with `stopAskedAt`, until it ends. A Run meanwhile
  is refused `pass-busy`. If the backend restarts and BullMQ re-runs the job, `beforeAcquire` skips it through
  `noRerun`, when the stop was recorded (R2).

**D10. The pass: the `stopped` outcome, its handlers, its job id.** In `reconcileTaggingEdges.js`:
- **Handlers.**
  - **Earlier registration.** Move the SIGTERM and SIGINT registration to just after the two lock checks
    (`:190-208`), before step 2.
  - **Later removal.** Remove them as the very last step of `finish()`, after the final save, the prune, `TASK_END` and
    the driver close.
  - **During `finish()`.** A signal that arrives then only sets `stopRequested`, which nothing reads any more. A
    registered listener does not keep the process alive.
  - **On the first-save failure return,** remove them before returning. No report carries this pid, because the atomic
    write failed.
  - **What this guarantees.** Every pid the server can read from `report.json` has its handler until the pass's last
    await.
  - **Never at module top level.** The real-time engine requires this module for `makeRunId`, so a top-level handler
    would land inside that engine.
- **`stopNow()`** becomes
  `finish('stopped', {reasonCode: 'requested', reason: 'stopped on request at a safe point', stopped: true, failure:
  null})`.
- **`exitCodeFor('stopped')` is 0**: nothing failed; the pass did what was asked. `finish` emits no `TASK_ERROR` for
  it, and `TASK_END` carries `outcome: 'stopped'`. The pessimistic record and its rewrites (C15) are unchanged.
- **The job id.** A new port, `job`, defaults to `process.env.BRAINSTORM_TASK_JOB_ID` when it matches
  `/^[A-Za-z0-9:._@-]{1,200}$/`, else null. The pessimistic record carries `job: job ? {id: job} : null` from its first
  save, so every rewrite and the final report carry it. It is the BullMQ job id, already public through the semaphore's
  events. It shows that a run was scheduled, or that it was not lined up through the app's
  routes, and nothing more (§ Constraints).
- **The processor.** `processor.js:137`'s spawn environment gains `BRAINSTORM_TASK_JOB_ID: String(job.id)` for every
  task. It is harmless elsewhere: no route serves another process's environment, and it is not in `brainstorm.conf`.
- **Old reports.** A report from before story 6 has no `job`. The view reads that as "start not recorded".

**D11. The record: `<stateDir>/control/record.json`.**
- **Where and how it is written.** The directory is 0700 and the file 0600. It is written only by the controller,
  through `state.writeAtomic`, inside the chain.
- **Shape:**

  ```json
  {"version": 1,
   "passes": {"<key>": {"jobId": "<job id>",
                        "start": {"at": "<iso>", "who": {"kind": "owner|admin|schedule|confirmation|local|other", "key": "<8 hex, owner or admin only>"}},
                        "stop": {"at": "<iso>", "runId": "<run id or null>", "who": {}},
                        "skip": false, "noRerun": false, "gaveUpAt": null}},
   "history": [{"action": "start|stop", "key": "<key>", "at": "<iso>", "who": {}}]}
  ```

  - `start` or `stop` is null when absent.
  - `history` is newest first, at most 10, and sorted by `at`, because a schedule start can be written late, at its due
    time.
  - Field names are `who`, `kind` and `key`, never `changedBy`, which the public report already uses for counts.
- **Pruning.** `passes` keeps, up to 40 entries:
  - the keys still busy;
  - the keys named by `history`;
  - the entries whose `jobId` is a job id of a run in `report.json`.

  Outside that cap, it also keeps every entry with `skip` or `noRerun` whose job the last queue read still found. All
  such entries are kept when that read failed, or when no read has happened yet in this process.
  *(Amended 2026-10-28: pruning also keeps an entry joined by its stop's `runId`, and entries are own properties; see
  Amendment 1 § C.)*
- **Reading.**
  - A missing file reads as empty.
  - A read error is `{unreadable: true, readError: code}`.
  - A file that will not parse is `{damaged: true}`.
- **Writing around a bad file.** Before writing, a step re-reads the record if its last read was not readable.
  - **While it still gives a read error, nothing writes it:**
    - a Stop takes effect in memory and answers `recorded: false`;
    - a schedule, confirmation or other start goes ahead unrecorded;
    - `gaveUpAt` is not recorded;
    - a Run answers 500 `record-unavailable`.
  - **A damaged file** is renamed to `record.json.damaged-<iso>` before a fresh record is written, so its bytes are
    kept.
  - **A successful re-read** clears the state.
- **Who is never logged.**

**D12. The public status: a `control` member, with no who.** `handleStatus` adds `control: {queue, busy, gaveUp}` to
`computeStatus`'s answer:
- **`queue`** is from D5.
- **`busy`** is D5's items, each `{key, jobId, state, since, behind, runId, stopAskedAt, startRecorded,
  confirmation}`.
  - **`startRecorded`** is true when the in-memory record has a start for the key. It is computed in the same snapshot,
    and it carries no who.
  - **Times.** Every time on `control` is an ISO string, converted by the server: `since`, `stopAskedAt`, and
    `gaveUp.at`.
- **`confirmation`** is set only on a running item, and only when a confirmation is involved:
  - `'taken-up'` when `listClaimed(runId)` finds a `${runId}-*.json` entry in `claimed/`, or
    `latest.confirmation.found === true`;
  - `'cannot-tell'` when a confirmation is pending and either the item has no run yet (starting), or the run's
    `phases` do not yet include `graph-read`. Saving `schema`, the stop check and the claim run in one synchronous
    stretch, so a report showing `schema` can be a claim in progress;
  - otherwise null.

  The server computes it (the ADR 0005 D7 precedent), so the view stays clock-free.
  - **Read order for this verdict.** `snapshot()` computes it (D5): `confirmation.json` first, then the `report.json`
    it uses for liveness and phases, then `listClaimed(runId)`. A claim that lands between any two of these reads is
    then seen as `'taken-up'` or `'cannot-tell'`, never null. A cached snapshot carries its verdict with it.
  - **A separate read.** This is apart from `handleStatus`'s existing report-then-confirmation reads for
    `confirmationPending`.
- **`gaveUp`** is `{key, at}` or null: `lastGaveUp` (or the record's latest `gaveUpAt`) whenever it is later than `latest.startedAt`,
  whatever else is busy; otherwise null.
- **A failed queue read** leaves the report served, with `queue: 'read-failed'`, never a 500.

**D13. The gated record read: `GET /api/tagging-edges/pass/record`.**
- **Gate.** It is mounted with `adminApi.requireOwnerOrAdmin` and re-checked with `ownerOrAdmin`, `sameHost` included,
  as `realtime/switch`'s GET is (ADR 0005 D6).
- **Answer.** `{success: true, state: 'recorded' | 'empty' | 'unreadable' | 'damaged', readError?, history,
  passes}`.
- **Route-table entries.** The auth middleware's substring lists, which earlier ADRs steered paths around, are gone
  (ADR `security-auth-exposure/0005`; `test/admin-action-sweep.test.js` T7). `ROUTE_ACCESS`
  (`src/middleware/routeAccess.js`) gains three entries, after `'GET /api/tagging-edges/held'` (`:441`):
  - `'GET /api/tagging-edges/pass/record': OWNER_READ`;
  - `'POST /api/tagging-edges/pass/run': OWNER_ACTION`;
  - `'POST /api/tagging-edges/pass/stop': OWNER_ACTION`.

  Without them the paths still resolve to `owner` (no match fails closed, `:542-547`), and AC6a accepts the guard alone.
  The entries keep the table total, as its header asks. They land in the same commit as the route registrations,
  because the sweep's T2 fails on an entry that matches no registered route.

**D14. Answers and codes.**
- **Fixed codes are sent as written:** `pass-busy`, `prompt-out-of-date`, `nothing-to-stop`, `pass-not-reachable`,
  `record-unavailable` and `QUEUE_UNAVAILABLE`.
- **Thrown codes go through ADR 0005's `allowErrorCode`.** Only a code taken from a thrown error does, and it goes as
  `cause` beside the fixed `code` (for example 500 `{code: 'record-unavailable', cause: 'ENOSPC'}`).
- **No answer carries a full pubkey.**
- **Story 5's convention holds:**
  - 401 and 403 are refusals, from `ownerOrAdmin` or the middleware;
  - 409 is a plain refusal with a `code`;
  - 503 means the queue is unavailable;
  - 500 carries a fixed `code`.

### UI

**D15. The senders.**
- **New senders.** `taggingPipelineFetch.js` gains `sendRun()` (POST `'/api/tagging-edges/pass/run'`, body `{}`) and
  `sendStop(targets)` (POST `'/api/tagging-edges/pass/stop'`, body `{targets}`), beside `sendSwitch`.
- **Same race and shapes.** Both use the private `raced(15000, …)` and resolve `sendSwitch`'s result shapes. They never
  reject.
- **Reads.** `readSection` stays GET-only (TF1). The record read is one more `useRead` in the panel's 5 s
  `Promise.allSettled` tick.

**D16. The view.** New pure functions in `taggingPipelineView.js`, all clock-free:
- **`busyView(statusBody)`** → `{known, why, items, canStop}`.
  - An absent `control` reads as not known, never as nothing waiting.
  - Each item's sentence says waiting since `<time>`, behind a pass ahead or other heavy database work, or running
    since `<time>`, plus "a stop was asked for at `<time>`".
  - `canStop` is true when some item has no `stopAskedAt`.
- **`runOutcome(result)` and `stopOutcome(result)`**, after `switchOutcome`:
  - done (Run: lined up; Stop: taken out of line, asked to stop, or too late);
  - done-unrecorded (Stop);
  - refused-busy, refused-stale, nothing-to-stop and not-reachable;
  - queue-unavailable;
  - record-unavailable (Run);
  - refused (401 or 403, with the "sign in again as the owner or an admin" sentence);
  - failed (with `code`, or the code-less sentence);
  - unknown (timeout, network or bad-json).

  The sentences are in the past tense. The not-reachable sentence: "The stop was refused: the pass was starting and
  had not yet recorded its process, so nothing changed. Press Stop again."
- **`stopPromptView(items, confirmation)`.** `confirmation` is `passView(statusBody).confirmation`, snapshotted with the
  items. It gives each item's block of the AC-3 text:
  - **a waiting item:** taken out of line, writes nothing, no schedule entry changes;
  - **a running item:** its next safe point, usually within seconds, minutes when the graph or relay is slow, at worst
    its 30-minute time-out; what it wrote stands; the next pass finishes the rest; no schedule entry changes;
  - **the warning,** when an item's `confirmation` is `'taken-up'` or `'cannot-tell'`;
  - **the "stays pending" line,** when `confirmation.state === 'pending'` and no item warns.
- **`passWho(recordRead, statusBody)`** joins the record to runs and busy items.
  - **A run's start.** It takes the record entry whose `jobId` equals the run's `job.id` and whose `start.at` is the
    latest one not after the run's `startedAt`.
    - **No such entry** reads "start not recorded", whatever the id: for example a report with no `job`, or a start
      whose record write failed.
    - **A legacy-id run** joins the `other` entry the gate recorded, and reads "started another way" (R7).
  - **A run's stop.** It takes the entry whose `stop.runId` equals the run's `runId`, under any key. Failing that, it
    takes the stop of the entry its start joined to, but only when that stop's `runId` is null. This covers a stop
    recorded on an entry with no start, and one recorded under a `run:` key.
  - **A running busy item with a run** takes who from its run, as `LatestPass` does, so the two lines agree.
    *(Amended 2026-10-28: joined as live, from the item's own state; see Amendment 1 § C.)*
  - **A starting item** (running, `runId` null) uses `startRecorded`:
    - **true:** the entry's who, or "refreshing" while the record answer lacks the entry;
    - **false:** "start not recorded".
  - **A waiting busy item:**
    - **`startRecorded` true:** the entry's who. While the record answer does not have the entry yet, it reads
      "refreshing".
    - **`startRecorded` false, and not yet picked up** (`behind !== 'heavy-work'`):
      - a `repeat:sched:` key is the schedule, at the id's millis;
      - a key that does not match `LINEUP_ID` is "started another way".
    - **Otherwise:** "start not recorded".
  - **Kept bodies.** Like `switchRecordView`, it says loading or failed rather than showing a kept body.
  - **Who** reads as the owner, an admin (with a shortened key), the schedule, the owner's confirmation, a local call,
    "started another way", or not recorded.
- **The stopped outcome's copy.** `EXPLANATIONS.passOutcome.stopped` and `passReason.requested` say "stopped on request
  at a safe point". Add `OUTCOME_TONE.stopped = 'neutral'`. `FINISHED` stays `done` and `done-removals-held`, so drift
  never explains by a stopped pass. The `signal` entries stay, for reports written before story 6.

**D17. The controls.**
- **Where they render.** A new `PassControls.jsx` inside `tp-pass`, in both the empty-report branch (after the "No pass
  has run yet" lines; `data-state` stays `empty`) and the ready branch. It sits after only the `!view` and loading
  early returns. It shows once the status has a body, with or without a report, and never during a Retry (the ADR 0005
  D12 precedent). It is rendered at one position in each branch.
- **Where its state lives.** Run's and Stop's state live in `TaggingPipelinePanel`, beside `change` and behind the same
  `mounted` guard: `run = {pending, outcome}` and `stop = {snapshot, confirmation, pending, outcome}`. They are passed
  down as props, so a Retry or the empty→ready switch loses nothing.
- **Run.** A `btn-small` "Run a pass now" that asks nothing, following story 5's Turn on:
  - while pending: disabled, `aria-busy`, with the text "Lining up a pass…";
  - after an answer: await the status and record re-reads, then clear pending;
  - on unknown: clear pending at once and fire the re-reads.
- **The pending-confirmation line.** When `passView.confirmation.state === 'pending'`, PassControls shows its own line
  beside Run: "The owner's confirmation is pending. The next pass to get past its start checks takes it up."
  HeldSection's `ConfirmationLine` is unchanged.
- **The busy list.** `busyView`'s items, each with who from `passWho`, plus "the server cannot tell whether a pass is
  waiting" when not known. A gave-up line shows from `control.gaveUp`.
- **Stop.** A `btn-small` "Stop", shown while `canStop`. It opens an inline prompt (the ADR 0005 D13 pattern: `settings-group`,
  `h4`, focus on Cancel through `useEffect`, never `ConfirmDialog` or `window.confirm`). The prompt is open while
  `stop.snapshot` is set.
  - **The snapshot.** It is the busy items with no `stopAskedAt`, plus `passView.confirmation`, taken when the prompt
    opens. `stopPromptView`, the button's label and `sendStop` use only those. The label reads "Stop the pass", or "Stop
    the passes" for more than one. No button name may match `/confirm/i` (B10).
  - **While the request is under way,** the prompt stays open with that button disabled, `aria-busy` and "Stopping…".
    This differs from story 5 on purpose; AC-3 says so. It sends
    `sendStop(snapshot.map(({key, state}) => ({key, state})))`.
  - **On any answer but unknown,** it awaits `Promise.allSettled([readStatus(), readPassRecord()])`, then clears pending
    and the snapshot and sets the outcome.
  - **On unknown,** it clears at once, fires the re-reads, and says the outcome is unknown.
  - **It closes by itself** when a read shows nothing busy, but only while it is not pending. It never rewrites its
    text from later polls. *(Amended 2026-10-28: only on a read whose busy list is known and empty; see Amendment 1
    § C.)*
- **The outcomes** of Run and Stop show in PassControls, whether or not Stop is shown, until the next Run or Stop is
  sent.
- **Section state.**
  - `tp-pass`'s `data-state` stays as it is (PS12).
  - A record failure renders its own `ReadFailed` inside the controls.
  - B36b keeps one Retry, because the controls never render without a status body. When both reads fail after a good
    read, two Retry buttons show, as in `tp-path`.

**D18. Who, per pass.**
- **`LatestPass` and `EarlierPasses`** add, from `passWho`:
  - "Started by `<who>` at `<time>`", or "start not recorded";
  - for a stopped pass, "stopped on request by `<who>` at `<the time the stop was asked for>`", or "stopped on request
    (who and when not recorded)";
  - for a pass with a stop entry but another outcome, "a stop was asked for at `<time>` by `<who>`, but the pass ended
    first".
- **The history list** shows the last 10 actions, newest first, with an empty state. A start whose entry has `gaveUpAt`
  says it gave up waiting and never began running.

**D19. Copy.**
- **The opening line** (`TaggingPipelinePanel.jsx:189-192`) says the page shows how the pass and the path are doing, and
  lets the owner or an admin switch the path and run or stop a pass.
- **The empty state** (`PassSection.jsx:171-175`) keeps "No pass has run yet" and names "Run a pass now" beside the
  Scheduled Tasks entry and the Task Explorer. PassControls follows it.
- **Style.** No `!`, no emoji, colours only through the token variables, and the existing PANEL_CLASSES only
  (PS16–PS24).

**D20. C5-4: the panel change.** At `TaggingPipelinePanel.jsx:214`, `schedPending={!answered(schedule)}` becomes
`schedPending={schedule.state === 'loading'}`.
- **Comments.** Reword the "first read" comments at `ScheduleSection.jsx:17-21`, `PathSwitch.jsx:19-20, :110-111` and
  `PathSection.jsx:158-160`.
- **Behaviour.** During a Retry after a failed read, the open off prompt now says the backstop is still being checked,
  as ADR 0005 D13's note already states. `answered()` stays, because drift uses it.
- **Why this option.** It costs one expression in a file this story already edits. The alternative, rewording D13's
  note, would have documented the mismatch rather than fixing it.

### Seams for Test Design

**Deps.**
- **The controller and routes** take a `deps` object, as `realtime.js` does:

  ```
  now, randomKey, stateDir,
  readReport, readConfirmation, isAlive,
  listClaimed(runId)  readdir of claimed/, filtered by `${runId}-`,
  queueHealth, taskQueueEnabled,
  queue               {getDelayed, getJobs, getActive, add} — each awaited and raced,
  kill(pid, signal),
  readRecord, writeRecord, renameRecord,
  ownerPubkey, getAdminPubkeys,
  timers              {stepMs, pidWaitMs, pidPollMs, endedKeysMs}
  ```

- **The gate** is a controller instance's `gate`. A test builds the instance with `createController(deps)` (D1).

**Store tests.** Default store paths must never resolve to `/var/lib/brainstorm/tagging-edges` inside the container
(the ADR 0005 § Seams warning). Use a temp `TAGGING_EDGES_STATE_DIR`.

**Load-time pins (new since `bdcda39b`).**
- **`test/admin-action-sweep.test.js` W1** runs the real `register(app)` in a child process (`test/helpers/routeWalk.js`)
  with only the strfry router's files stubbed. It fails on a register error, or on a run over 60 s.
- **`test/task-queue-jobid-valid.test.js` V1 and `test/assistant-scores-route.test.js` P5** require `queue/index.js` in
  the gate's own process.
- **So nothing loads with side effects.** `pass.js`, the controller and `jobGates.js` do no disk or Redis work when they
  load:
  - no `<stateDir>/control/` mkdir and no record read until first use (D1);
  - `gateFor` requires the controller only when it is called (D3).

**Fakes:**
- **A BullMQ-faithful fake queue,** a subset pinned by this ADR's probes:
  - unique ids add to `wait` behind an active job, and a re-add of an existing id joins (P2);
  - a due scheduled job stays `delayed` while another job is active (Q2);
  - `remove` answers 0 for an active job and throws `belongs to a job scheduler` for a scheduler's current job (P5,
    Q2);
  - a scheduler's next iteration is created at pickup, at its usual slot (Q3);
  - a stalled job goes back from active to wait.

  Its id rule is checked against BullMQ itself. Run `LINEUP_ID`'s form and the legacy fixed id through
  `test/task-queue-jobid-valid.test.js`'s `bullmqRejects` (`:49-60`): a real `Job` and `validateOptions`, no Redis.
  Ledger `2026-10-14-fakes-hide-library-validation` asks this of any faked library call.

  The Tester re-derives the probe from § Context's P1, P2, P5, Q2 and Q3. It may commit it as a non-registered
  `test/probe-*.js` script, as ADR `task-queue-scheduler/0022` did (`test/probe-bullmq-removeOnComplete-immediate.js`).
- **A fake semaphore** with `shouldAbandon`, and a short `acquireTimeoutMs` for the 4 h give-up. Set
  `BRAINSTORM_STRUCTURED_LOGGING=false`.
- **Runner seams.** `fakeSignals.fire`, `childSandbox` and `makeWorld`, with the new `job` port.
- **A handler-lifetime pin.** An injected `state.writeReport` records whether the fake signals object still holds the
  pass's SIGTERM listener on each call. On the final call it does; after `run()` resolves it does not. A fake has no
  default action, so `fakeSignals.fire` alone cannot prove this.

**Revised pins** (revised, not deleted):
- **Runner.** SR50, SR68 and SR69 now expect `outcome: 'stopped'`, `reasonCode: 'requested'`, `failure: null`, and exit
  0 where they check the exit. Each keeps what it proves about the claim and the batches; SR69 still proves the claim is
  spent. SR1's title gains `job`.
- **Codes guard.** D10 removes the runner's only `stage: 'signal'` and `code: 'signal'` literals, so the Tester, citing
  this ADR:
  - lowers `FLOORS.failureStage` to 8, `failureCodeRunnerLiterals` to 8, `codeValues` to 19 and `codeValueLiterals` to
    10;
  - drops `signal` from PC42's named list;
  - raises `FLOORS.passOutcome` to 5.

  The `signal` EXPLANATIONS stay. `signal` is still in `SCAN_ERROR_CODES`, so PC45 and PC46 are unchanged. PC18 and
  PC19 fail until `stopped` and `requested` have sentences.
- **State routes.** `routeDeps` gains `queueHealth` and `lineUp`.
  - **RT17** injects `queueHealth: () => 'ready'` and a `lineUp` spy. Its pings assertion becomes "`queueHealth` was
    consulted before `lineUp`". Its `runViaQueueAsync` argument checks become the `lineUp` call: mode `confirm`,
    `who {kind: 'confirmation'}`. It checks `jobId` against the spy's key.
  - **RT18** injects a `queueHealth` that answers `'not-ready'`, and asserts zero `lineUp` calls. RT19 also asserts
    zero `lineUp` calls.
- **Request pins** (the story's test tasks):
  - PS13 allows exactly the POSTs inside `sendSwitch`, `sendRun` and `sendStop`.
  - PS14's `READ_PATHS` gains `/api/tagging-edges/pass/record`, and the two POST paths are allowed. Its message names
    story 7 for Confirm.
  - PS28 names the three senders.
  - B38's allowed set gains the record read.
  - B9 follows the new empty-state line, and B10's message names story 7.
  - TF1 is unchanged.

**Registration pins.**
- **Registration.** SWR11- and SWR67-style tests register each new route exactly once, behind
  `adminApi.requireOwnerOrAdmin`.
- **Access.** As SWR11, SWR67 and DR26 now do (`test/tagging-edges-wiring.test.js:853-866`, `:2213-2226`;
  `test/tagging-edges-drift-route.test.js:943-953`), they check that `resolveRouteAccess` gives `'owner'` for both POSTs
  and for GET and HEAD `/api/tagging-edges/pass/record`. They also check that it still gives `'public'` for
  `/api/tagging-edges/status`.
- **The sweep suites** (`test/admin-action-sweep.test.js` AC6a, T2 and T4; `test/admin-action-sweep-access.test.js`)
  then cover the entries unchanged. T2 fails on an entry with no route, so the entries are the Implementer's, not part
  of the failing-test commit.
- **The run-task branch.** A source pin checks that `runTask.js`'s branch is `return await` on the delegate.

**The run-task route through the middleware.**
- **The middleware's refusals.** For every task, the refusal of a signed-out caller (401) or a signed-in stranger (403)
  is the middleware's, pinned by `test/task-routes-owner-admin.test.js` T1–T3.
- **This story's run-task cases** run the real `authMiddleware` in front of the real `handleRunTask`, with the
  delegate's deps injected (that suite's `startApp` pattern).
  - They assert that nothing is lined up or recorded on each refusal, and expect the middleware's texts there.
  - `ownerOrAdmin`'s texts are expected only in the delegate's unit tests.
  - Owner and admin cases through the real check need the conf seam in a child process, as `test/helpers/accessHarness.js`
    does.

**New cases the review named** (beyond the story's test tasks):
- After a Stop of a running pass, the status still lists it as running with `stopAskedAt` until it ends, and a Run in
  that time is refused `pass-busy`.
- A legacy-id pass is stopped by job id.
- The confirm route meets a pass whose record appeared after its re-read.
- A record that gives a read error is unchanged, byte for byte, after a Stop and after a scheduled start.
- A pass gives up while a due scheduled run waits behind it, and the gave-up line still shows.
- A due scheduled run waiting behind a pass shows "the schedule" before it is picked up. The fixtures include the
  seed form of the id (`repeat:sched:seed:reconcileTaggingEdges:<millis>`).
- After a restart, an admin stops the orphaned pass, and the orphan ends while its job is still stale-active. The
  status then shows nothing busy, and Run lines up a pass.
- A Run whose add times out leaves no start in `passes` or `history`.
- A claim lands between each pair of the D12 verdict's reads.
- A Stop catches a pass while it is starting, the pass is then refused at its identity check, and the answer is
  too-late with the stop recorded.
- A stopped run whose start was not recorded shows "stopped on request by `<who>` at `<time>`". So does a stopped hand
  run, which has no job id.
- A first pass waits, and Run is pressed, with no report yet.

**Live and evidence** (not the gate):
- **Restart the backend first.** Run `docker exec tapestry supervisorctl restart brainstorm` before any local evidence:
  the backend serves the bind-mounted source only after a restart. On 2026-10-27 the local control panel (started
  2026-10-02) still ran the pre-merge middleware: an unmatched `/api/` GET answered 404, where the route table answers
  401.
- **Holding the heavy lock locally.**
  `docker exec tapestry-redis redis-cli HSET taskQueue:resource-class:neo4j-heavy:holders evidence-hold <now + 600000>`.
  Release it with `HDEL`; it lapses by itself.
- **A due scheduled run.** Enable the local seed entry while the lock is held. Keep it enabled until the stop and the
  next slot have been shown, then disable it. Disabling calls `removeJobScheduler` (`scheduler.js:93-95`), which deletes
  a due run still in `delayed`.
- **A running pass held at a safe point.** `kill -STOP` the pass after its record appears, press Stop, then
  `kill -CONT`.
- **A direct local call.** `docker exec tapestry curl -X POST
  'http://127.0.0.1:7778/api/run-task?taskName=reconcileTaggingEdges'`. A host `curl` is not local.
- **On staging,** the owner chooses how to hold the lock. Any of these works:
  - a heavy task started from the Task Explorer;
  - the Scores page's Recalculate (`src/api/assistant/scores.js`), which lines up `updateAllScoresForOwner` or a
    customer's `processCustomer`;
  - a Redis lease over SSH.

  Deploy-safety reads unsafe while a heavy job is active. A bare Redis lease, with no pass job waiting, reads safe.
- **Restarts.** Restart the backend only while no pass job waits or holds a lease.

### Docs (the Implementer)

**OPERATIONS:**
- **§12.8.**
  - Running it: the panel's Run.
    - **Run-task, for every task.** It starts any task only for the owner, admins and direct local calls, since
      2026-10-10. `:721`'s "(signed in)" is stale.
    - **For this pass, run-task also** refuses a request from another site and refuses while busy. With the queue off,
      the legacy spawn is refused.
  - **`src/api/openapi.yaml`** (`:4594-4616`, the `/api/run-task` entry): add this pass's answers (409 `pass-busy`, 503,
    500, the cross-site 403).
  - Stopping it: waiting versus running, the five safe points, `stopped`, the confirmation warning, and that a stalled
    re-run of a stopped job is skipped.
  - The record and its gated read.
  - Confirm stays the console snippet's until story 7.
- **§10.6** (`:578`): an on-demand job (run-task, the panel's Run, the confirm route) is removed when its heavy-lock
  wait times out, so it does not stay in BullBoard's failed tab. A scheduled run's job does stay.

**BIBLE:**
- **§11:** the three new routes, and run-task's branch for this pass.
- **§6:** the `stopped` outcome, `job`, the `control` member, and who started or stopped a pass.
- **§16:** a new entry, and the Last-updated line.

**Carry-forwards** (the story routes each to its role):
- C5-5, C5-6, C5-8's BIBLE (`:685`; the POST row is `:684`) and OPERATIONS (`:788`) halves, and C5-10.
- C5-8's wording: no `Origin` passes `sameHost`. An `Origin` that does not parse (such as `null`), or one whose hostname
  differs from `Host`'s, gets 403 `cross-site request refused`. In `ownerOrAdmin` it is the last check.
- C5-8's rewrite also says which check answers. Through the proxy, the route table's check answers first on both
  switch routes (`src/middleware/routeAccess.js:443-444`; `src/middleware/auth.js:400-405`):
  - no session gets 401 "Sign in as the owner or an admin to do this.";
  - a signed-in session that is neither owner nor admin gets 403 "Only the owner or an admin can do this.".

  `Not authenticated` now reaches only a direct local call, and `cross-site request refused` only the owner or an
  admin.

## Amendments to ADRs 0002–0005 (dated notes; the original text stays)

### ADR 0002

**Header.** Add `**Amended (2026-10-02):** by tagging-edges/0006 — run, stop, the stopped outcome, who started a pass,
the run-task route's answers for this pass.`

**Dated notes at these lines:**
- **`:40-43` (AC-7's restatement):** a stop asked for on the panel, or any SIGTERM or SIGINT, now reads as its own
  outcome, `stopped`, not `failed` (story 6 AC-3).
- **`:80-82` (the join):** this pass's starts from app code each add a new job id (0006 D2). They no longer join; a
  BullBoard add can still use any id.
- **`:89-95` (who can reach what):** stale for every task since 2026-10-10.
  - **Who may now.** `/api/run-task` and schedule create, update and delete admit only the owner, an admin or a direct
    local call (`security-auth-exposure` story 6, PR #840).
  - **Where it is held.** Since story 8, the route table (`src/middleware/routeAccess.js:365-372`; ADR
    `security-auth-exposure/0005`), which removed the lists cited at `auth.js:388-424`.
  - **The moved lines.** Local trust is now `src/middleware/auth.js:356-371`, `isOwner()` is `:277-294`, and the session
    pubkey is set with `authenticated = true` at `:54-55`.
  - **For this pass,** run-task also refuses a request from another site, refuses while busy, and refuses with the queue
    off (0006 D7).
- **`:232-235` (D8-A, D8-B):** their premises are stale since 2026-10-10, as `:89-95`: that any signed-in session can
  start a task, and that schedule CRUD is open to any signed-in session. Both rejections stand: the owner's side can
  still set a flag or a schedule argument, and a confirmation must never ride either.
- **`:468-473` (the confirm route's enqueue):**
  - it is now `lineUp({who: {kind: 'confirmation'}, mode: 'confirm'})` (0006 D8), checked by `queueHealth()`;
  - while a pass that has not yet claimed is busy, nothing is added or recorded, and the answer says `joined: true`;
  - otherwise a new job is added under its own id.

  A join is now the controller's decision, never BullMQ's id.
- **`:487-492`:** "which any session may start" is stale since 2026-10-10: only the owner, an admin or a direct local
  call may start a task. A run-task start of this pass is also gated as 0006 D7 says. It still carries no confirmation.
- **`:504` (the outcome enum):** adds `stopped`. Records gain `job: {id} | null`, which is additive (reportVersion 1).
- **`:548-552` (Stopped runs):**
  - a SIGTERM or SIGINT stops at the next of the five safe points (before and after the claim, after each read, before
    each write batch) and writes `stopped`, `reasonCode: 'requested'`;
  - the handlers now last from just after the lock checks to the end of `finish()`;
  - the pass's run and stop are story 6's, and Confirm is story 7's (story 6's Planning, 2026-10-02).
- **`:554-560` (who reads it):** the status also returns `control: {queue, busy, gaveUp}`, with no who (0006 D12).
- **`:708` (AC-7, one pass at a time):** app starts of this pass no longer dedup by id (0006 D2). Concurrency 1, the
  controller's busy check, the pgrep guard and the kernel lock keep one pass at a time.
- **`:790-793` (decision 7):** a stopped claimant now reads `stopped`. The claim is spent as before.
- **`:820` (decision 14):** until story 7, AC-5's confirmation is the signed-in `fetch`.
- **`:822-823` (decision 15):** a pass taken out of line never starts a process and writes no report (0006 D3).
- **`:892-895` (the runner's entry and deps):** `stopped` exits 0, and the deps gain `job` (0006 D10).
- **`:1126` (§ Seams):** a stop between batches is now `stopped`, `reasonCode: 'requested'`, exit 0.
- **`C2` (`:1175-1181`):** `stopped` exits 0.
- **`:1243` and `:1247` (Out of scope):** the pass's run and stop are story 6's, Confirm story 7's.
  - **Settled elsewhere.** Who may start a task, and gating non-owner access to admin mutations (intake 2026-07-21), were
    settled by `security-auth-exposure` stories 6 and 8 (2026-10-10): the owner, admins and direct local calls. The
    intake entry was picked up there, and its book `admin-action-owner-check` closed on 2026-10-11.
  - **This ADR's part.** What run-task answers for this pass.

### ADR 0003

- **`:944`:** story 6 adds the pass's Run and Stop POSTs and a gated record GET, and story 7 adds Confirm. The path is
  unchanged.

### ADR 0004

**Story 6's notes:**
- **`:11` and `:610-614`:** the panel now runs and stops a pass (0006).
- **`:73-74` and `:311-312`:** stale since 2026-10-10. The middleware's substring lists are gone, and an unlisted `/api/`
  path, a GET included, is the owner's side's (ADR `security-auth-exposure/0005`; `src/middleware/routeAccess.js:542-547`).
  New routes take route-table entries instead (0006 D13).
- **`:370`:** the empty state names Run. Run and Stop are story 6's, and Confirm is story 7's (story 6's Planning,
  2026-10-02).
- **`:528-530`:** besides `sendSwitch`, the panel sends `sendRun` and `sendStop`.
- **`:828` (T12):** the runner no longer mints `signal` as `failure.stage` or `failure.code` (0006 D10). A stop on
  request finishes `stopped` with `failure: null`. The `signal` entries stay, for older reports.
- **`:879`:** Run and Stop are story 6's (0006), Confirm story 7's.
- **`:881-882`:** a waiting pass is shown since story 6 (0006 D5, D12).

**C5-9, re-dated in place.** Change only the date, from 2026-10-02 to 2026-10-01, in the notes at `:261`, `:347` and
`:840`.

### ADR 0005

**C5-9, re-dated in place.** Change only the date, from 2026-10-02 to 2026-10-01, in the notes at `:339`, `:444` and
`:483`. *(The story says "ADR 0005's six notes". Three of the six are ADR 0004's, listed above.)*

**Carry-forwards:**
- **C5-7 (D5, `:331-333`):** a removal that empties settings.json's `adminPubkeys` falls back to
  `BRAINSTORM_ADMIN_PUBKEYS`, which may still name the removed admin (`src/utils/config.js:100-113`;
  `src/api/admin/index.js:226-245`). The same holds for story 6's Run and Stop.
- **C5-8 (D6, `:336-340`, and Context `:63-64`):** no `Origin` passes. An `Origin` that does not parse (such as `null`),
  or one naming another hostname, is refused 403. `sameHost` is `ownerOrAdmin`'s last check. On the POST, 415 and 400
  follow it; on the GET, nothing does.
- **C5-4 (D13's note, `:483-485`):** the panel now counts any loading read of the schedule as pending (0006 D20), so the
  note holds as built.

**Story-7 pointers.** Dated notes that keep run and stop as story 6's and move Confirm to story 7 (story 6's Planning,
2026-10-02), at `:610`, `:626`, `:667`, `:698`, `:743`, `:748`, `:752`, `:755` and `:760`.

## Out of scope

- **Confirm from the panel,** what admins see in its place, and who confirmed: story 7.
- **Who may change schedules:** settled outside this story.
  - Since 2026-10-10, schedule create, update and delete are for the owner, an admin or a direct local call
    (`security-auth-exposure` story 6; `src/middleware/routeAccess.js:366-367`, `:372`).
  - Since story 8, no action route is open unless the table opens it.

  This story changes neither.
- **BullBoard's controls,** and a read-only mode for them.
- **Stopping other tasks,** or a general stop, cancel or job gate for the task system. `jobGates.js` serves this one task.
- **Naming the heavy lock's holder,** or clearing leaked leases at boot (ledger `2026-09-27-stale-heavy-lease-after-deploy`).
- **The 30-minute time-out's `kill -9`.**
- **`confirmationPending.mintedBy`** on the public status: story 7's question.

---

## Amendment 1 — Stop's target keys, residual R9, and the as-built readings (2026-10-28)

**Raised by:** the owner's two decisions of 2026-10-28 on the implemented story (`ca504c42`): "Widen the rule" (§ A,
§ B) and "Add them now" (the Tester's tests for § C). The text above stays. Dated pointers at D5, D6, D8, D9, D11, D16,
D17 and § Residuals lead here. Where this amendment and the text above differ, this amendment holds.

### What D9's body rule got wrong

D9 allowed each target key at most 120 characters of `[A-Za-z0-9:._@-]`. The keys a Stop must name are not the app's
to choose:
- **The busy list keys every job of the pass's queue by its BullMQ id** (D2, D5). BullMQ 5.76.10 accepts far more than
  D9's class. This was checked on 2026-10-28 with BullMQ's own `Job` validation and no Redis, as
  `test/task-queue-jobid-valid.test.js`'s `bullmqRejects` does:
  - accepted: `manual run`, `job/1`, ids of 300 and 5,000 characters, and ids carrying a newline, NUL, U+0085 or
    U+2028;
  - refused, of the ids tried: an integer id, and an id with one `:`. BullMQ lets a `:` through only when the id
    splits into exactly three parts (probe P1).

  A BullBoard add (R3) can use any of the accepted ids.
- **Liveness rule 2 accepts a report job id of up to 200 characters** (D5, D10's pattern), past D9's 120.
- **D9 step 2 makes every open item a required target.** One busy job whose key D9 refused therefore made every Stop
  fail for as long as that job stayed busy: up to 4 h for a job waiting behind the heavy-task lock. The panel names
  every open item, so it got 400; a client that left the item out got 409 `prompt-out-of-date`. A Stop of the owner's
  own pass failed the same way.

### Options

- **Option A: any key the server could have emitted, bounded (chosen; the owner's decision).** A key is any string of
  1 to 256 characters with no control character. The server only compares it with its own busy list (§ A).
- **Option B: keep D9's class, and leave out of step 2 any open item whose key the class refuses.**
  - A Stop would then leave running a busy pass that its prompt showed. The only fix is for the prompt to say that
    pass cannot be stopped, which is new copy and a new state for a case only an outside add makes.
  - The item would also keep Run refused `pass-busy` while it waits.

  Rejected.
- **Option C: a fixed-size handle per busy item.** The status would give each item a `ref` (say, the first 16 hex of
  the key's SHA-256), and Stop would name refs.
  - It removes R9 (a).
  - But it changes the public status's shape and the panel's echo, and adds a collision rule.
  - It leaves R9 (b), the cap of 50.

  Rejected for a case only an outside add makes.

### A. D9's body rule, as amended

This supersedes D9's sentence "The body is `{targets: [...]}`: one to fifty entries, distinct keys, each key at most
120 characters of `[A-Za-z0-9:._@-]`."
- **The body.** A JSON object whose `targets` is an array of 1 to 50 entries.
  - **Each entry** is an object `{key, state}`, with `state` exactly `'waiting'` or `'running'`.
  - **Keys are distinct by `===`.** No trimming, no case folding and no Unicode normalisation, because the server's own
    comparison is `===`.
  - **Extra members** on the body or on an entry are ignored, and only `{key, state}` reaches the controller (as
    built).
  - **Anything else** is 400, before the chain, and changes nothing.
- **A key** is a string of 1 to 256 characters with no forbidden character.
  - **Characters are counted in UTF-16 code units,** as JavaScript's `key.length` counts them. An astral character,
    such as an emoji, counts 2. Why code units:
    - the comparison the rule guards is JavaScript string equality, which works on code units;
    - `length` is what the code, the tests and the fakes already measure, with no `u`-flag regex or spread needed;
    - every key the app makes is ASCII, where the two counts agree;
    - code units bound the memory and comparison cost directly;
    - a key of 256 code units has at most 256 code points, so the rule is never looser than a code-point count.
  - **The forbidden characters:**
    - U+0000–U+001F (C0), U+007F (DEL) and U+0080–U+009F (C1). Together these are Unicode's general category Cc, so "no
      control character" means Cc exactly. C1 is included because it is the same category as C0 (U+0085 is a line
      break in some readers);
    - U+2028 (LINE SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR). JavaScript treats them as line terminators, as it
      does `\n` and `\r`, so the set is "nothing that controls or ends a line".
  - **Everything else is allowed.** That includes the space, U+00A0, the format characters (U+200B–U+200F,
    U+202A–U+202E, U+2066–U+2069, U+FEFF) and lone surrogates. The panel never renders a key as text: it uses a key
    only as a React `key`, in comparisons, and in the Stop body's echo, so these cannot mislead a reader. A target the
    server did not emit is left out at step 2.
- **The predicate.** Copy it as it is. It has no `g` or `y` flag, because `test` on a global regex keeps `lastIndex`
  between calls.

  ```js
  const STOP_TARGETS_MAX = 50;
  const STOP_KEY_MAX = 256; // UTF-16 code units, as String.prototype.length counts them
  const STOP_KEY_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/; // Cc (C0, DEL, C1), LS, PS
  const isStopKey = (key) => typeof key === 'string'
    && key.length >= 1 && key.length <= STOP_KEY_MAX
    && !STOP_KEY_FORBIDDEN.test(key);
  ```

- **Boundaries.**
  - **Accepted:**
    - a 1-unit key, a 256-unit key, and 128 emoji (256 units);
    - `manual run`, `job/1`, `__proto__` and `constructor`;
    - a key carrying U+0020, U+007E, U+00A0, U+2027 or U+202A.
  - **Refused:**
    - `''`, a 257-unit key, and 128 emoji plus one more character;
    - a key carrying U+0000, U+001F, U+007F, U+0080, U+009F, U+2028 or U+2029 anywhere;
    - a key that is not a string;
    - 0 entries, 51 entries, or two entries with the same key.
- **Why it is safe.**
  - **A target's key is only compared.** `stop` uses it for two things only:
    - to look up the state the prompt showed for each of the snapshot's own open items (a `Map`, step 2);
    - while the queue cannot be read, to compare it with the live item's key (step 1).

    A target that is not open is left out (step 2). Every mark, record write and signal after that takes its key from
    the snapshot's item, never from the body. So a key reaches the record, the in-memory marks or a signal only when it
    is a key the server itself emitted. The pid comes from `report.json`, never from a key.
  - **Nothing new is disclosed.** The keys the server emits are already on the public status (D12).
  - **Keys are record property names, read and written as own properties** (§ C, D11). `__proto__`, `constructor` and
    the like are ordinary entries. In memory, keys index `Map`s and `Set`s, which have no inherited keys.
  - **A key never becomes** a path, a Redis argument, a shell argument, a regex, or text on the panel.
  - **The work is bounded:** at most 50 keys of at most 256 units each, compared with one busy list.
- **The 400's sentence** names the new rule. Its wording is the Implementer's; today's names the 120 rule
  (`pass.js:90`).

### B. Residual R9: a busy job a Stop cannot name

Stop names every open item (D9 step 2), at most 50 of them, each by a key that § A accepts. While either case below
holds, every Stop answers 400 from the panel and changes nothing, a Stop of the owner's own pass included. A client
that leaves the item out gets 409 `prompt-out-of-date` instead.
- **(a) An open item whose key is longer than 256 code units, or carries a forbidden character.**
  - **The app never makes one.** Every key the app makes is ASCII, at most 200 characters, with no forbidden character.
    That covers D2's keys, and D5's legacy, `run:` and rule-2 keys. Scheduled Tasks entry ids are either minted
    `entry-<uuid>` or are the seeds.
  - **Only an add outside the app makes one:** a BullBoard add (R3), or a hand-edited entry id in
    `scheduled-tasks.json`.
- **(b) More than 50 open items.**
  - **From BullBoard:** more than 50 adds.
  - **Through the app:** more than 50 enabled Scheduled Tasks entries for this task whose runs come due while a pass is
    busy. Each entry's scheduler keeps one due run (probe Q2). The panel already warns when more than one entry is
    enabled (ADR 0004).

**What the panel shows** (as built at `ca504c42`):
- The busy list shows each item as usual, Stop stays shown, and the prompt opens with a block per item.
- On confirm, `sendStop` sends every open item. The server answers 400 with no `code`, and `stopOutcome` reads that as
  `failed`, with `code: 'http-400'`.
- After the re-reads the prompt closes, and PassControls shows, in the `bad` tone: "The server answered with an error
  status that does not say whether the stop took effect. What is busy shows here from the next read. Try again. If it
  repeats, check the control panel's log, /var/log/supervisor/brainstorm.log in the tapestry container. Code:
  `http-400`".

**The way out** is BullBoard (`/admin/queues`, on the owner's side). Remove the job there while it is in BullMQ's
wait, paused or prioritized state, or delayed when it is not a scheduler's. BullBoard cannot clear two cases:
- **A job the worker has picked up,** whether waiting for the heavy-task lock or running, cannot be removed (probe P5).
  It leaves the busy list when it ends: when its pass ends, or when its lock wait gives up after 4 h.
- **A due scheduled run** cannot be removed directly (probe Q2). Disable its Scheduled Tasks entry instead:
  `removeJobScheduler` deletes a due run still in `delayed`. That is also the way out of (b) through the app.

**(c) Found while writing this amendment; § A does not change it.** This case covers a *running* pass whose BullMQ id
is outside D10's pattern: it has a character outside `[A-Za-z0-9:._@-]` (such as `manual run` or `job/1`), or more
than 200 characters. Only a BullBoard add makes such an id.
- **Two listings for one process.** The pass records `job: null` (D10), so liveness rule 3 lists it as `run:<runId>`.
  Rule 1 cannot match its active job, so the job is listed again, under its own key, as running and starting (D5, phase
  `launched`). The panel therefore shows two running passes for one process.
- **Every Stop is refused.** Each one waits 3 s for that key's first record, which never names it, and then answers
  409 `pass-not-reachable` (D9 step 3), unless the job ends within those 3 s. The panel shows: "The stop was refused:
  the pass was starting and had not yet recorded its process, so nothing changed. Press Stop again."
- **How long it lasts.** Until the pass ends (usually seconds; at worst its 30-minute time-out) and its job's
  finishing window has passed. The job is active, so BullBoard cannot remove it.
- **What § A changes here.** Before this amendment the same running job gave 400, because its key failed the
  120-character rule, so § A leaves this case where it was. § A does fix the same job while it waits, which is the
  long case (up to 4 h).
- **Not decided here.** Aligning D10's pattern with § A's rule would let rule 1 match the job, which would end the
  double listing. That changes what the public report may carry (§ Constraints), so it is the owner's call.

R9 is a residual and needs no test of its own. § A's boundary cases cover the 400.

### C. The as-built readings, ratified (the Implementer's own check, 2026-10-28)

The story's § Deviations, in the group "After the Implementer's own check against the ADR", changed the code after Test
Design. Each reading below is now the contract, and the Tester's tests for them (the owner's "Add them now") pin it.
Code references are to `src/pipeline/tagging-edges/control/index.js` at `ca504c42` unless another file is named.
- **D6 step 3 and D8: the take-back of a failed add.**
  - **As built.** The start's write keeps a copy of the record it wrote over (`commitStart`'s `prior`). After a damaged
    file is renamed aside, that copy is a fresh, empty record. When the add fails or times out, one best-effort write
    (`takeBack`) puts back that copy's `passes` and `history`, pruned as every write is (D11).
  - **When it runs.** Run takes back only after its start was written: a failed start write answers 500
    `record-unavailable` before any add. The confirm route takes back only when its start write succeeded. Both writes
    are in one chain step.
  - **Only states what the original meant:** the record as if the start had never been asked for. It supersedes the
    literal "remove the start entry and its history line", which would lose an older line or entry that the start's
    caps (10 lines, 40 entries) had pushed out. What a reader sees is unchanged: after a failed add there is no start
    in `passes` or `history`.
- **D11: pruning also keeps an entry joined by its stop.**
  - **As built, what counts as joined.** An entry is joined to a run in `report.json` (`latest` or `previous`) when
    its `jobId` is that run's `job.id`, *or when its `stop.runId` is that run's `runId`*.
  - **The order within the cap of 40:** the step's own keys, then the keys busy at the last snapshot, the keys with a
    gate phase, the keys `history` names, and then the joined entries.
  - **Beyond the cap,** every `skip` or `noRerun` entry whose job the last queue read found is kept. All of them are
    kept when that read failed, or when none has run yet.
  - **A `report.json` read that throws** while pruning keeps every entry.
  - **Changes the contract:** one more kept class, and the rule for a read that throws. It matches D16's join, which
    finds a stop by `stop.runId` under any key. Without it, the `run:<runId>` entry of a stopped hand run or orphan
    (its `jobId` null) was dropped while its run was still shown, and the run read "stopped on request (who and when
    not recorded)".
- **D11: entries are own properties.**
  - **As built.**
    - **Found** only as the record's own property (`Object.prototype.hasOwnProperty.call`, in `entryAt`).
    - **Created** with `Object.defineProperty` (enumerable, writable, configurable), never by assignment (`entryIn`).
    - **Iterated** with `Object.entries` and `Object.values`, and **pruned** through `Object.fromEntries`.
    - **Round-tripped** through `JSON.parse` and `JSON.stringify`, which keep a `__proto__` member as an own one.
  - **The panel** reads the record answer the same way (`own()` in `passWho`, `ui/src/utils/taggingPipelineView.js`).
    So any key, `__proto__` and `constructor` included, is an ordinary entry.
  - **Only states what the original meant:** `passes` maps a key to its entry. The rule binds every later reader and
    writer of the record. It was needed before § A too, because `__proto__` matched D9's old class.
- **D5: `stopAskedAt`, one execution per mark.**
  - **As built.** An in-memory mark under the item's key (`stopsAsked`, read by `stopAskedOf`) counts only for the
    execution it was asked for:
    - a running item with a `runId`: when the mark's `runId` is null or the same;
    - a running item with no `runId` yet (starting): when its launch (`phases.since`) is no later than the mark;
    - a waiting item: never.
  - **The rest of D5 stands.** The record's stop under the item's key counts as written. A running item with a `runId`
    falls back to any mark or record stop with that `runId`.
  - **Changes the contract** by narrowing D5's letter. The story already required it:
    - AC-3: a pass that lines up after a stop was asked for is not covered by that stop;
    - D9: the skip is per job.

    So a re-run of the same job id in the same process is not shown as already stopped, whether it follows a stop that
    could not be recorded (R2) or comes through BullBoard (R3). Stop applies to it in its turn.
- **D16: a running busy item's who.**
  - **As built.** A busy running item whose `runId` names a run in the status takes who from that run, joined as live
    (`runWho(run, entries, true)`), not from `status.running`.
  - **Only states what the original meant:** "as `LatestPass` does, so the two lines agree". A `control` served from
    D5's 1 s reuse can say running while `status.running` says the run has ended, and the line must not say "running"
    and "stopped on request" together.
- **D17: the Stop prompt closes by itself only on a known, empty read.**
  - **As built** (`TaggingPipelinePanel.jsx`, `nothingBusy`). It closes when a read's busy list is known
    (`control.queue === 'ok'`, which is `busyView`'s `known`) and empty, and never while its stop is under way. A read
    that cannot tell leaves it open.
  - **Only states what the original meant:** "when a read shows nothing busy". A read that cannot tell is never
    "nothing waiting" (AC-2). It supersedes the story's earlier panel deviation "whether or not the queue state is
    known".

The other items in that group, PassControls' `key` and the copy, are the Implementer's under D17 and D19, and need no
note.

### D. Docs and code that follow

**For the Implementer:**
- **`BIBLE.md:677`** (§11, the `POST /api/tagging-edges/pass/stop` row). "each at most 120 characters of
  `A-Za-z0-9:._@-`" becomes § A's rule: each 1 to 256 characters (UTF-16 code units), with no control character
  (U+0000–U+001F, U+007F–U+009F) and no U+2028 or U+2029.
- **`OPERATIONS.md:723`** (§12.8, "Stopping it"). It states no key rule. Add one sentence on R9's way out, for when
  every Stop fails with `http-400` (or `pass-not-reachable`) while a job added in BullBoard is busy:
  - remove the job in BullBoard if it has not been picked up yet;
  - disable the Scheduled Tasks entry of a due scheduled run;
  - or wait for a picked-up job to end.
- **`src/api/openapi.yaml`.** It has no `/api/tagging-edges/pass/stop` entry and states no 120 rule, so nothing
  changes.
- **BIBLE's Last-updated line and its §16 story-6 entry.** Neither states the key rule, so neither changes.
- **The code.** `src/api/tagging-edges/pass.js:29` (`TARGET_KEY_RE`), `:90` (the 400's sentence) and `:95` follow § A's
  predicate.

**For the Tester** (Phase 3's lane, listed so nothing is missed):
- PX21 in `test/tagging-edges-pass-routes.test.js`: its title at `:849`, the 120-character case at `:879`, and the
  header note at `:95`;
- the browser mock's Stop body check, `test/helpers/taggingPipelineFixtures.js:1419`;
- the test plan's body-rules line, `6-pass-run-and-stop.test-plan.md:193`.

### Consequences of the amendment

- **What a Stop can now name.** Every busy job the app makes. Also any job a BullBoard add makes whose key is at most
  256 code units with no forbidden character, waiting or running, apart from R9 (c).
- **What does not change:** the public status, the record's shape, the panel, and every other route.
- **Firmware reinstall required?** No. No concept definition changes.
