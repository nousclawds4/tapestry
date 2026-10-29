'use strict';
/**
 * Shared fakes for story 6's suites (epic tagging-edges): running and stopping the gap-filling pass.
 *
 * Story: engineering-team/stories/tagging-edges/6-pass-run-and-stop.md (AC-1..AC-6, Test tasks)
 * ADR:   engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md — § Context (probes P1, P2, P5, Q2, Q3),
 *        D1–D14, and § Seams for Test Design (the deps list, the fakes, the load-time pins).
 *
 * Load-safe: this file requires only Node built-ins at load time. BullMQ, the semaphore and every module under test are
 * required lazily, inside the function that needs them, so a suite that requires this file always loads, red phase
 * included. Nothing here touches /var/lib/brainstorm, Redis, the network or the host's /proc.
 *
 * ─── API ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Constants
 *   OWNER, ADMIN, STRANGER          'a'.repeat(64), 'd'.repeat(64), 'c'.repeat(64) (test/helpers/taggingPipelineFixtures.js)
 *   OWNER_KEY, ADMIN_KEY            their 8-character keys, as the record names them (D11)
 *   HOST, ORIGINS                   the fake Host header, and Origin values: same / other / unparsable ('null')
 *   TASK, LEGACY_ID                 'reconcileTaggingEdges' (the task, and the legacy fixed job id, R7)
 *   LINEUP_ID                       /^reconcileTaggingEdges-[0-9a-f]{12}$/ (D2)
 *   SCHED_PREFIX, SEED_ENTRY_ID     'repeat:sched:', 'seed:reconcileTaggingEdges' (the seed backstop's entry id, D2)
 *   TIMEOUT_MS                      1800000, the pass's 30-minute time-out (job data's timeoutMs)
 *   PATHS                           run, stop, record, status, confirm, runTask (D6, D7, D9, D13)
 *   MODULES                         repo-relative paths of every module story 6 adds or changes
 *   ADR, adr(d)                     'ADR tagging-edges/0006', and adr('D5') → 'ADR tagging-edges/0006 D5'
 *   ADR_TIMERS                      the ADR's step / pid-wait / pid-poll / ended-keys values (2000 / 3000 / 100 / 10000 ms)
 *   FAST_TIMERS                     the test defaults: { stepMs: 150, pidWaitMs: 2000, pidPollMs: 10, endedKeysMs: 2000 }.
 *                                   A test that waits a window out overrides it (makeWorld({ timers: { pidWaitMs: 300 } }))
 *   T0                              a fixed fake "now" (2026-10-27T12:00:00.000Z) for clocks
 *
 * Loading
 *   loadModule(relPath, exportsWanted, adrRef, { fresh, forget })
 *       Requires `relPath` (repo-relative) when called, never before. exportsWanted is a name, a list of names, or a
 *       map { name: 'function' | 'object' | … } that also checks typeof. A missing module, a module that throws while
 *       loading, or a missing (or wrongly typed) export throws an assert.AssertionError naming the module, what is
 *       missing and adrRef. `fresh: true` forgets the module (and `forget`'s paths) from require's cache first.
 *   forgetModules(relPaths)         drop repo-relative modules from require's cache
 *
 * Job ids (D2's definitions, for building expectations — not implementations under test)
 *   lineUpKey(n)                    a LINEUP_ID-shaped id, distinct per n
 *   scheduledJobId(entryId, millis) 'repeat:sched:<entryId>:<millis>' (the entry id may contain ':')
 *   millisOf(jobId)                 the digits after a scheduled id's last ':' as a number, else null
 *   jobKeyOf(job)                   job.id, or '<id>@<timestamp>' for the legacy fixed id
 *   jobIdOfKey(key)                 the default jobId a key implies: the key, or LEGACY_ID for a legacy key (jobKeyOf's
 *                                   form). Not D2's rule, which compares with each item's own jobId (D2, amended); a
 *                                   dashboard id such as reconcileTaggingEdges@x is its own key, which has the legacy
 *                                   form, so this reads it as the legacy id (for @<digits> it is a legacy job's very
 *                                   key, R9 (d)); a test of one passes its jobId
 *   lineUpData(timeoutMs?)          enqueueTask's data shape, as D2 adds it
 *   lineUpOpts(jobId)               { jobId, removeOnComplete: true, removeOnFail: true }
 *   bullmqRejects(jobId, opts?)     BullMQ's own verdict on a custom id: null when accepted, else its message (a real
 *                                   bullmq Job and validateOptions over a stub queue; no Redis). The technique of
 *                                   test/task-queue-jobid-valid.test.js (ledger 2026-10-14-fakes-hide-library-validation).
 *
 * makeFakeQueue({ clock, name, concurrency = 1, maxStalledCount = 1, validateIds = true })
 *   The BullMQ subset the ADR's probes pin (P1, P2, P5, Q2, Q3), with no worker of its own: a test picks jobs up.
 *   Library surface (async, as BullMQ's):
 *     add(name, data, opts)          BullMQ's id rule first (bullmqRejects; a refused id rejects with BullMQ's message and
 *                                    stores nothing). An id whose job still exists, in ANY state (no removeOn* removed
 *                                    it), joins silently: it resolves a job with that id and the CALLER's name, data and
 *                                    opts, the stored job is unchanged, and nothing in the answer says it joined (P2;
 *                                    only q.joins shows it, for tests). Otherwise the job is stored: delay > 0 →
 *                                    'delayed'; a paused queue → 'paused'; priority > 0 → 'prioritized'; else 'wait',
 *                                    behind every job already waiting (an active job never blocks an add). With no
 *                                    jobId, ids are '1', '2', … as BullMQ's counter.
 *     getActive(), getDelayed(), getWaiting(), getPrioritized()
 *     getJobs(types, start, end, asc) BullMQ's type names: 'waiting' (= 'wait', and adds 'paused', as BullMQ does),
 *                                    'paused', 'prioritized', 'delayed', 'active', 'completed', 'failed'. Ids are
 *                                    deduped across types, as BullMQ's Set does; unknown types give nothing.
 *     getJob(id), getJobState(id)    'waiting' | 'paused' | 'prioritized' | 'delayed' | 'active' | 'completed' | 'failed'
 *                                    | 'unknown'
 *     remove(id)                     throws "Job <id> belongs to a job scheduler and cannot be removed directly.
 *                                    removeJob" for a scheduler's CURRENT job (Q2, checked first, as BullMQ does); 0 for
 *                                    an active job (P5); else 1 — also for an id that is not there, as BullMQ's script
 *                                    answers.
 *     upsertJobScheduler(id, { every }, { name, data, opts })   a new scheduler's first job is due now (delay 0 → wait),
 *                                    as BullMQ's `every` does; an existing one only takes the new template
 *     removeJobScheduler(id)         removes the scheduler and its current job while that job is delayed
 *     getJobSchedulers(), getJobScheduler(id)   { key, id, name, every, next } — next is the current job's millis
 *   Each job snapshot carries id, name, data, opts, timestamp, delay, processedOn, finishedOn, attemptsMade,
 *   attemptsStarted, stalledCounter, failedReason, returnvalue, repeatJobKey, deferredFailure, and (not enumerable)
 *   remove() — throws "Job <id> could not be removed because it is locked by another worker" when remove(id) answers 0
 *   (P5) — and getState(). Data and opts round-trip through JSON, as Redis stores them (queryParams: undefined drops).
 *   Controls (synchronous):
 *     advance(ms), now()             move the shared clock
 *     pickUp()                       the worker's moveToActive: null while `concurrency` jobs are active or the queue is
 *                                    paused (concurrency 1: a due scheduled job therefore stays 'delayed' while another
 *                                    job is active, Q2). Otherwise: due delayed jobs (timestamp + delay <= now) move to
 *                                    the back of 'wait' (delay set to 0), then the oldest waiting job (else the best
 *                                    prioritized) becomes active with processedOn = now. A scheduler's current job, when
 *                                    picked up, creates the scheduler's next job at its usual slot (Q3: prev + every;
 *                                    BullMQ's catch-up rule when that slot has already passed). A job carrying a deferred
 *                                    failure goes straight to failed and comes back with `deferredFailure` set.
 *     complete(id, returnvalue)      active → completed (deleted when opts.removeOnComplete is true)
 *     fail(id, error)                active → failed (deleted when opts.removeOnFail is true)
 *     stall(id)                      BullMQ's stall check: active → the FRONT of 'wait', stalledCounter + 1; past
 *                                    maxStalledCount a non-repeat job carries "job stalled more than allowable limit"
 *     work(fn)                       pickUp() now, then await fn(job) and complete or fail it: → null, or { job, done }
 *                                    where done resolves { outcome: 'completed' | 'failed', returnvalue, error }
 *     plantScheduled({ entryId = SEED_ENTRY_ID, millis, every, data, name })   a scheduler whose current job is due at
 *                                    `millis`, sitting in 'delayed' as BullMQ leaves it (timestamp = millis - every,
 *                                    delay = every) → its job id
 *     pause(), resume()
 *     inject(method, { error, hang, undefinedEntries, times = 1 })   the next `times` calls of a library method reject
 *                                    with `error` (an Error, or a code string), never settle (`hang`), or answer with
 *                                    `undefinedEntries` undefined entries appended (a job that vanished mid-read)
 *     releaseHangs()                 settle every hung call by performing it now (a hung add lands, R1) → the count
 *     state(id), ids(state), jobs(), has(id), scheduler(id), dump(), calls (every library call, in order), joins
 *
 * makeFakeRedis({ status = 'ready' })   for the REAL resourceSemaphore.createSemaphore
 *   defineCommand(name, def)        recorded, otherwise a no-op; semaphoreAcquire is always there
 *   semaphoreAcquire(key, leaseId, cap, ttlMs, now)   ACQUIRE_LUA: sweep leases whose expiry < now, then HSET the lease
 *                                    at now + ttl when HLEN < cap → 1, else 0
 *   hdel, hset, hget, hgetall, hlen, ping
 *   holdLease({ resourceClass = 'neo4j-heavy', leaseId = 'another-task', ttlMs = 600000, expiresAt })   a lease held by
 *                                    another task (expiry on Date.now(), the clock the semaphore passes)
 *   releaseLease({ resourceClass, leaseId }), leases(resourceClass), holdersKey(resourceClass)
 *   inject(method, { error, hang, times }), calls
 * makeSemaphore(redis, { caps, pollIntervalMs = 5, acquireTimeoutMs = 150, leaseTtlMs })   the real semaphore over the
 *                                    fake Redis, with short polls and a short give-up (the 4 h wait). Call it inside
 *                                    structuredLoggingOff().
 * makeScriptedSemaphore({ free = true, pollIntervalMs = 5, acquireTimeoutMs = 150 })   a semaphore with D4's contract
 *                                    for gate tests that must not depend on D4's implementation: acquire(cls, ctx)
 *                                    polls ctx.shouldAbandon (→ null), wins while `free` (→ release), and gives up with
 *                                    code RESOURCE_CLASS_WAIT_TIMEOUT; `free`, `calls`, `releases`.
 * structuredLoggingOff() → restore(); withStructuredLoggingOff(fn)   BRAINSTORM_STRUCTURED_LOGGING=false around queue
 *                                    and semaphore code
 *
 * What is logged, and what is signalled (D11 "Who is never logged"; D9: a signal goes only through the kill dep)
 *   Each works the same in this process and in a child (`node -e` that requires this file by its absolute path, as the
 *   PX suite's pxChild does). Everything they record is plain JSON data, so a child can print it in its result line.
 *   guardProcessKill({ label = 'the suite' }) → { restore(), directKills }
 *       Replaces process.kill until restore(): every call, whatever the pid or signal (0 included), is pushed to
 *       directKills as { pid, signal } and throws Error "kill ESRCH <pid> (refused by <label>'s guard)" with code
 *       'ESRCH', so no fake pid (4242, 5001 and up) can ever signal a real process. It is the CT suite's guardKill:
 *       CT's message is label 'the CT suite'. A suite installs it around its test loop and fails a test whose run grew
 *       directKills (note directKills.length before the test, compare after). restore() is idempotent.
 *   recordStructuredEvents({ forget = [], now = Date.now }) → rec
 *       Puts a recording stand-in for src/utils/structuredEvents.js in require's cache until rec.restore(). Every
 *       function the real module exports (read from its source text, never loaded; emitTaskEvent today) records the
 *       call and writes nothing. It records whatever BRAINSTORM_STRUCTURED_LOGGING says, so a suite keeps structured
 *       logging off and still sees what would have been logged. Install it before any module that requires
 *       structuredEvents loads: a module that already holds the real emitTaskEvent keeps it. `forget` (repo-relative or
 *       absolute paths) drops those modules from require's cache first, so their next require takes the stand-in;
 *       restore() puts back their earlier entries (or drops the copies loaded meanwhile).
 *         rec.events     every call as { type, taskName, target, meta } (args 0..3; meta defaults to {}), the shape
 *                        task-queue-job-gate.test.js's withRealSemaphore records
 *         rec.calls      every call as { fn, args }
 *         rec.lines      every call as the real module would have written it: { timestamp, eventType, taskName, target,
 *                        metadata, scriptName, pid } (timestamp from `now`)
 *         rec.jsonl()    rec.lines as JSONL text
 *         rec.writeJsonl(logDir) → file   writes rec.lines to <logDir>/taskQueue/events.jsonl (replacing it), the file the
 *                        Task Explorer reads when process.env.BRAINSTORM_LOG_DIR = logDir. logDir must be absolute and
 *                        never under /var/log/brainstorm or /var/lib/brainstorm.
 *         rec.text()     events, calls and lines as one JSON text, for a search
 *         rec.file       the cache key the stand-in sits under; rec.restore() is idempotent
 *   captureConsole({ methods = ['log','info','warn','error','debug','trace'], passThrough = false }) → cap
 *       Wraps those console methods until cap.restore(); passThrough also calls the method it replaced. Console only:
 *       process.stdout.write and process.stderr.write are left alone (a child's result line goes there).
 *         cap.lines      [{ level, text, json }]: text as console prints it (util.format), json the arguments as JSON
 *                        (an Error as { name, message, code, stack }; a cyclic value as String)
 *         cap.text()     every line's text and its json, joined, so a printed needle (kind: 'local') and a JSON one
 *                        ('"kind":"local"') are both found; cap.restore() is idempotent
 *
 * Builders
 *   runIdAt(ms | iso, hex8)          a run id in RUN_ID_RE's grammar
 *   passRecord(o)                   a report.json latest/previous record in the pass's own shape. o.state: 'running'
 *                                    (default; endedAt null, running true), 'done', 'done-removals-held', 'stopped' (D10:
 *                                    reasonCode 'requested', failure null), 'failed', 'refused' (at the identity check),
 *                                    'killed' (the pessimistic record left by a kill: running true, never ended). Also
 *                                    runId, hex, startedAt, endedAt, pid, startTime, jobId (string → job { id }; null →
 *                                    job null), preStory6 (no `job` member at all), phases (names) or through (a phase
 *                                    name: every phase up to it), confirmation ({ found, honoured }) and `over`.
 *   PHASES                          the pass's phase names, in order
 *   reportOf(latest, previous)      { reportVersion: 1, latest, previous }
 *   confirmationRecord(o)           a pending confirmation.json as the confirm route writes it
 *   nonceOf(label), claimedName(runId, nonce)
 *   statLine(o), procStat(pid, o), makeReadFile(proc)   /proc/<pid>/stat fixtures for state.isAlive (never host /proc)
 *   makeProcs()                     a process table: spawn(pid, startTime), exit(pid), zombie(pid), reuse(pid, start),
 *                                    alive(pid), isAlive(record) (state.isAlive's rule), readFile (its /proc view)
 *   makeTempStateDir(label)         mkdtemp under os.tmpdir() → { dir, controlDir, recordFile, useAsEnv() → restore,
 *                                    cleanup() }
 *   makeClock(startMs = T0)         { now(), iso(ms?), advance(ms), set(ms) }
 *   sleep(ms), waitFor(pred, { timeoutMs, everyMs, what }), settle()
 *   whoOf(kind, pubkey?), recordEntry(o), historyLine(action, key, at, who), recordFile({ passes, history })   D11 shapes
 *   makeRecordStore({ record, text, readError, writeError, renameError })   the record file, in memory:
 *       read() → null (missing; D11 "reads as empty", the realtime.js readRecordFile precedent), { unreadable: true,
 *       readError } (a read error), { damaged: true } (text that does not parse to an object), else the parsed record;
 *       write(record) stores its JSON text (throws Error with `code` while writeError is set); rename(...args) keeps the
 *       old bytes in `damaged` and leaves no file. bytes(), parsed(), set(record), setText(text), failReads(code),
 *       failWrites(code), failRenames(code), heal(), gateWrites() / releaseWrites() (writes wait until released),
 *       writes, renames, damaged.
 *   makeWorld(o) → world            everything the controller's deps read, plus world.deps — the § Seams deps list:
 *       now, randomKey, stateDir, readReport, readConfirmation, isAlive, listClaimed, queueHealth, taskQueueEnabled,
 *       queue { getDelayed, getJobs, getActive, add }, kill, readRecord, writeRecord, renameRecord, ownerPubkey,
 *       getAdminPubkeys, timers { stepMs, pidWaitMs, pidPollMs, endedKeysMs }
 *     Every dep but now, stateDir, ownerPubkey, getAdminPubkeys and timers is a recording spy: world.calls is one ordered
 *     log across all of them ({ seq, name, args }), world.names() the names in call order, world.callsOf(name). The
 *     synchronous deps stay synchronous (readReport, readConfirmation, isAlive, listClaimed, queueHealth,
 *     taskQueueEnabled, kill, readRecord, writeRecord, renameRecord); the queue's are async. randomKey() answers the
 *     whole key, LINEUP_ID-shaped (world.keys lists them).
 *     State a test sets: world.report (report.json or null), world.reportError, world.confirmation, world.confirmationError,
 *     world.claimed (a Set of claimed/ names), world.health ('ready' | 'not-ready' | 'off'), world.enabled (the flag),
 *     world.owner, world.admins, world.killError (a code kill throws for a live pid), world.stopOnSignal (SIGTERM ends
 *     the latest run 'stopped' at once), world.onKill(pid, signal).
 *     Scenario helpers: startPass(o) → the running record (latest; the old latest moves to previous; a live process),
 *     endPass(o) (the latest run ends: o.state, default 'done'; its process exits), setPhases(names), claim(runId) (the
 *     pending confirmation moves to claimed/; o.save marks latest.confirmation.found), kills, cleanup().
 *   adrWorkerCallback({ gate, semaphore, processor, taskName, resourceClass, taskDef })   D3's worker callback as the ADR
 *       writes it, for driving a controller's gate in unit tests (the real one in queue/index.js has its own pins)
 *   makeFakeProcessor(world, { writesNoReport })   processJob(job): starts a run in `world` under job.id and settles when
 *       that run ends (end(jobId, o) or world.endPass / a SIGTERM with world.stopOnSignal); writesNoReport ends at once
 *       with no run. calls, running(jobId).
 *
 * Requests
 *   fakeReq({ method, url, session, localTrusted, headers, body, query })   Express-shaped: get(), header(), is()
 *   passReq(as, { method, path, body, origin, contentType, query, headers })   as: 'owner' | 'admin' | 'stranger' |
 *       'signed-out' | 'unauthenticated' (a session with the owner's key but authenticated false) | 'local' (localTrusted,
 *       no session, no Origin). origin: undefined (none), 'same', 'other', 'null' or any string. POST defaults to body {}
 *       and content-type application/json; contentType: null sends none.
 *   fakeRes() → res with status(), json(), send(), end(), set(); res.statusCode, res.body, res.done
 *   callHandler(fn, req, deps, { timeoutMs = 3000 }) → { res, status, body, rejected }   rejected is the handler's
 *       rejection (D6: every pass.js handler resolves and never rejects), or null
 *
 * Self-check: `node test/helpers/taggingEdgesPassFakes.js` (or require it and call selfCheck()) exercises the fake queue
 * against the probe facts, the fake Redis under the real semaphore, the deps builder and the loader.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { AssertionError } = require('assert');

const REPO = path.resolve(__dirname, '..', '..');

// ─── constants ─────────────────────────────────────────────────────────────────────────────────────────────────────

const OWNER = 'a'.repeat(64);
const ADMIN = 'd'.repeat(64);
const STRANGER = 'c'.repeat(64);
const OWNER_KEY = OWNER.slice(0, 8);
const ADMIN_KEY = ADMIN.slice(0, 8);
const HOST = 'tapestry.example';
const ORIGINS = Object.freeze({ same: `http://${HOST}`, other: 'https://elsewhere.example', null: 'null' });

const TASK = 'reconcileTaggingEdges';
const LEGACY_ID = TASK;
const LINEUP_ID = /^reconcileTaggingEdges-[0-9a-f]{12}$/;
const SCHED_PREFIX = 'repeat:sched:';
const SEED_ENTRY_ID = 'seed:reconcileTaggingEdges';
const TIMEOUT_MS = 1800000;
const HOLDERS_PREFIX = 'taskQueue:resource-class:';
const WAIT_TIMEOUT_CODE = 'RESOURCE_CLASS_WAIT_TIMEOUT';
const T0 = Date.UTC(2026, 9, 27, 12, 0, 0);
const DEFAULT_EVERY_MS = 6 * 60 * 60 * 1000;

const PATHS = Object.freeze({
  run: '/api/tagging-edges/pass/run',
  stop: '/api/tagging-edges/pass/stop',
  record: '/api/tagging-edges/pass/record',
  status: '/api/tagging-edges/status',
  confirm: '/api/tagging-edges/confirm-held-removals',
  runTask: '/api/run-task',
});

const MODULES = Object.freeze({
  controller: 'src/pipeline/tagging-edges/control/index.js',
  gate: 'src/pipeline/tagging-edges/control/gate.js',
  store: 'src/pipeline/tagging-edges/control/store.js',
  pass: 'src/api/tagging-edges/pass.js',
  routes: 'src/api/tagging-edges/index.js',
  realtime: 'src/api/tagging-edges/realtime.js',
  jobGates: 'src/manage/taskQueue/queue/jobGates.js',
  queue: 'src/manage/taskQueue/queue/index.js',
  semaphore: 'src/manage/taskQueue/queue/resourceSemaphore.js',
  processor: 'src/manage/taskQueue/queue/processor.js',
  runTask: 'src/api/manage/commands/runTask.js',
  runner: 'src/pipeline/tagging-edges/reconcileTaggingEdges.js',
  state: 'src/pipeline/tagging-edges/state.js',
  routeAccess: 'src/middleware/routeAccess.js',
  auth: 'src/middleware/auth.js',
});

const ADR = 'ADR tagging-edges/0006';
const adr = (decision) => (decision ? `${ADR} ${decision}` : ADR);

/** D1, D9: the ADR's values. */
const ADR_TIMERS = Object.freeze({ stepMs: 2000, pidWaitMs: 3000, pidPollMs: 100, endedKeysMs: 10000 });
/**
 * The durations makeWorld's deps carry unless a test overrides them (makeWorld({ timers })). A hung Redis read times out
 * in 150 ms (stepMs). pidWaitMs and endedKeysMs are 2000 ms: a test that writes the pass's record or calls gate.ended
 * after a short real sleep must land inside those windows, and 2000 ms leaves room for a GC or scheduler pause when
 * every suite runs in one process. pidWaitMs stays under stop()'s 3000 ms call limit, so an implementation that never
 * sees the pid answers pass-not-reachable rather than timing out. A test that waits a window out sets its own short
 * value (CT43 pidWaitMs 300; CT19 and JG24 endedKeysMs 200).
 */
const FAST_TIMERS = Object.freeze({ stepMs: 150, pidWaitMs: 2000, pidPollMs: 10, endedKeysMs: 2000 });

// ─── small utilities ───────────────────────────────────────────────────────────────────────────────────────────────

const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const iso = (ms) => new Date(ms).toISOString();
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
/** One macrotask, so every queued microtask and immediate has run. */
const settle = () => new Promise((r) => { setImmediate(r); });
function brief(v, n = 300) {
  let s;
  try { s = JSON.stringify(v); } catch (_) { s = String(v); }
  if (s === undefined) s = String(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function errorWithCode(codeOrError, message) {
  if (codeOrError instanceof Error) return codeOrError;
  const code = String(codeOrError || 'EIO');
  return Object.assign(new Error(message || `${code} (injected by taggingEdgesPassFakes)`), { code });
}
function safeClone(v) {
  try { return clone(v); } catch (_) { return v; }
}

/** Poll `pred` until it is truthy (it may be async); throw naming `what` after timeoutMs. */
async function waitFor(pred, { timeoutMs = 2000, everyMs = 5, what = 'the condition' } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const v = await pred();
    if (v) return v;
    if (Date.now() >= until) throw new Error(`waited ${timeoutMs} ms for ${what}, and it never held`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(everyMs);
  }
}

// ─── loading ───────────────────────────────────────────────────────────────────────────────────────────────────────

function forgetModules(relPaths) {
  for (const rel of [].concat(relPaths || [])) {
    try { delete require.cache[require.resolve(path.join(REPO, rel))]; } catch (_) { /* not loadable: nothing cached */ }
  }
}

function wantedList(exportsWanted) {
  if (exportsWanted == null) return [];
  if (typeof exportsWanted === 'string') return [{ name: exportsWanted, type: null }];
  if (Array.isArray(exportsWanted)) return exportsWanted.map((name) => ({ name: String(name), type: null }));
  return Object.entries(exportsWanted).map(([name, type]) => ({ name, type: type ? String(type) : null }));
}

/**
 * Require a repo module when a test runs, never when a suite loads. Throws an AssertionError naming the module, what is
 * missing and the ADR decision when the module is absent, fails to load, or lacks a wanted export.
 */
function loadModule(relPath, exportsWanted, adrRef, opts = {}) {
  const ref = adrRef || ADR;
  const wanted = wantedList(exportsWanted);
  const names = wanted.map((w) => w.name);
  const abs = path.join(REPO, relPath);
  if (opts.fresh) forgetModules([relPath, ...(opts.forget || [])]);
  let mod;
  try {
    mod = require(abs);
  } catch (e) {
    const head = firstLine(e);
    const absent = e && e.code === 'MODULE_NOT_FOUND' && head.includes(abs);
    const message = absent
      ? `${relPath} does not exist yet (${ref})${names.length ? `: expected a module exporting ${names.join(', ')}` : ''}`
      : `${relPath} did not load (${ref}): require failed: ${head}`;
    throw new AssertionError({ message, actual: head, expected: names, operator: 'loadModule' });
  }
  const missing = wanted.filter((w) => mod == null || mod[w.name] === undefined || (w.type && typeof mod[w.name] !== w.type));
  if (missing.length) {
    const what = missing.map((w) => {
      if (mod == null || mod[w.name] === undefined) return w.type === 'function' ? `${w.name}()` : w.name;
      return `${w.name} as a ${w.type} (it is a ${typeof mod[w.name]})`;
    });
    const has = Object.keys(mod || {}).sort();
    throw new AssertionError({
      message: `${relPath} does not export ${what.join(', ')} yet (${ref}); it exports ${brief(has, 400)}`,
      actual: has,
      expected: names,
      operator: 'loadModule',
    });
  }
  return mod;
}

// ─── job ids (D2) ──────────────────────────────────────────────────────────────────────────────────────────────────

function lineUpKey(n = 1) {
  return `${TASK}-${(0xa00000000000 + Number(n)).toString(16).slice(-12)}`;
}
function scheduledJobId(entryId, millis) { return `${SCHED_PREFIX}${entryId}:${millis}`; }
function millisOf(jobId) {
  const m = /:(\d+)$/.exec(String(jobId || ''));
  return m ? Number(m[1]) : null;
}
function jobKeyOf(job) {
  if (!job) return null;
  return String(job.id) === LEGACY_ID ? `${job.id}@${job.timestamp}` : String(job.id);
}
/**
 * The default jobId a key implies, for building expectations: the key itself, or LEGACY_ID for a legacy key (the
 * `${job.id}@${job.timestamp}` form jobKeyOf gives). The code under test compares with each busy item's own jobId,
 * never the key (D2, amended). A dashboard id such as reconcileTaggingEdges@x is its own key, and that key has the
 * legacy form, so this reads it as the legacy id (for @<digits> it is a legacy job's very key, R9 (d)); a test of one
 * passes its jobId explicitly rather than taking it from here.
 */
function jobIdOfKey(key) {
  return typeof key === 'string' && key.startsWith(`${LEGACY_ID}@`) ? LEGACY_ID : key;
}
function lineUpData(timeoutMs = TIMEOUT_MS) {
  return { taskName: TASK, customerArgs: null, queryParams: undefined, timeoutMs };
}
function lineUpOpts(jobId) { return { jobId, removeOnComplete: true, removeOnFail: true }; }

/**
 * BullMQ's own verdict on a custom job id: null when accepted, else its error message. A real bullmq Job is built over a
 * minimal queue stub and asked to validateOptions, the check queue.add runs before it reaches Redis (the technique of
 * test/task-queue-jobid-valid.test.js:49-60). BullMQ is required here, lazily.
 */
function bullmqRejects(jobId, opts = {}, name = 'jobid-guard', data = {}) {
  let Job;
  try { ({ Job } = require(path.join(REPO, 'node_modules', 'bullmq'))); } catch (e) {
    throw new Error(`bullmq must load to check a job id with BullMQ's own rule (run \`npm ci\`): ${firstLine(e)}`);
  }
  const queue = { name: 'jobid-guard', opts: {}, qualifiedName: 'bull:jobid-guard', keys: {}, toKey: (k) => `bull:jobid-guard:${k}`, client: Promise.resolve({}) };
  try {
    const job = new Job(queue, name, data, { removeOnComplete: true, removeOnFail: true, ...opts, jobId }, jobId);
    job.validateOptions(job.asJSON());
    return null;
  } catch (e) {
    return e && e.message ? e.message : String(e);
  }
}

// ─── the clock ─────────────────────────────────────────────────────────────────────────────────────────────────────

function makeClock(startMs = T0) {
  let t = Number(startMs);
  return {
    now: () => t,
    iso: (ms) => iso(ms === undefined ? t : ms),
    advance(ms) { t += Number(ms); return t; },
    set(ms) { t = Number(ms); return t; },
  };
}

// ─── fault injection, shared by the fake queue and the fake Redis ──────────────────────────────────────────────────

function makeFaults() {
  const plans = new Map(); // method → [{ error, hang, undefinedEntries, left }]
  const hung = [];
  return {
    inject(method, plan = {}) {
      const list = plans.get(method) || [];
      list.push({ ...plan, left: plan.times === undefined ? 1 : plan.times });
      plans.set(method, list);
    },
    /** The plan for this call of `method`, consumed; or null. */
    take(method) {
      const list = plans.get(method);
      if (!list || !list.length) return null;
      const p = list[0];
      p.left -= 1;
      if (p.left <= 0) list.shift();
      return p;
    },
    /** Run `perform` under the plan for `method` (a thunk; may throw or return a value or promise). */
    run(method, perform) {
      const p = this.take(method);
      if (!p) return Promise.resolve().then(perform);
      if (p.error) return Promise.reject(errorWithCode(p.error));
      if (p.hang) {
        return new Promise((resolve, reject) => {
          hung.push(() => { Promise.resolve().then(perform).then(resolve, reject); });
        });
      }
      if (p.undefinedEntries) {
        return Promise.resolve().then(perform).then((out) => (Array.isArray(out) ? out.concat(Array(p.undefinedEntries).fill(undefined)) : out));
      }
      return Promise.resolve().then(perform);
    },
    releaseHangs() {
      const n = hung.length;
      while (hung.length) hung.shift()();
      return n;
    },
    pending: () => hung.length,
  };
}

// ─── the fake BullMQ queue ─────────────────────────────────────────────────────────────────────────────────────────

/** BullMQ's getJobSchedulerEveryNextMillis (includes/getJobSchedulerEveryNextMillis.lua), with no startDate. */
function everyNextMillis(prevMillis, every, now, offset) {
  let next;
  if (prevMillis == null) {
    next = now;
  } else {
    next = prevMillis + every;
    if (next < now) next = Math.floor(now / every) * every + every + (offset || 0);
  }
  let off = offset;
  if (!off) off = next - Math.floor(next / every) * every;
  return { next: Math.floor(next), offset: Math.floor(off) };
}

const LIST_TYPES = { wait: 'wait', waiting: 'wait', paused: 'paused', prioritized: 'prioritized', delayed: 'delayed', active: 'active', completed: 'completed', failed: 'failed' };
const STATE_NAMES = { wait: 'waiting', paused: 'paused', prioritized: 'prioritized', delayed: 'delayed', active: 'active', completed: 'completed', failed: 'failed' };

function makeFakeQueue(o = {}) {
  const clock = o.clock || makeClock();
  const name = o.name || TASK;
  const concurrency = o.concurrency || 1;
  const maxStalledCount = o.maxStalledCount === undefined ? 1 : o.maxStalledCount;
  const validateIds = o.validateIds !== false;
  const faults = makeFaults();
  const jobs = new Map(); // id → stored record (the "job hash")
  const lists = { wait: [], paused: [], prioritized: [], delayed: [], active: [], completed: [], failed: [] }; // ids, oldest first
  const schedulers = new Map(); // scheduler id → { id, name, data, opts, every, offset, prevMillis }
  const calls = [];
  const joins = []; // P2's silent joins, for tests only
  let counter = 0;
  let seq = 0;
  let paused = false;

  const now = () => clock.now();
  const drop = (id) => { for (const l of Object.values(lists)) { const i = l.indexOf(id); if (i >= 0) l.splice(i, 1); } };
  const place = (rec, state, front = false) => {
    drop(rec.id);
    rec.state = state;
    if (front) lists[state].unshift(rec.id); else lists[state].push(rec.id);
  };
  const dueAt = (rec) => rec.timestamp + (rec.delay || 0);

  function snapshot(rec) {
    if (!rec) return undefined;
    const job = {
      id: rec.id,
      name: rec.name,
      data: clone(rec.data),
      opts: clone(rec.opts),
      timestamp: rec.timestamp,
      delay: rec.delay,
      processedOn: rec.processedOn,
      finishedOn: rec.finishedOn,
      attemptsMade: rec.attemptsMade,
      attemptsStarted: rec.attemptsStarted,
      stalledCounter: rec.stalledCounter,
      failedReason: rec.failedReason,
      returnvalue: clone(rec.returnvalue),
      repeatJobKey: rec.repeatJobKey,
      deferredFailure: rec.deferredFailure,
    };
    Object.defineProperty(job, 'remove', {
      enumerable: false,
      value: async () => {
        const out = await api.remove(job.id);
        if (!out) throw new Error(`Job ${job.id} could not be removed because it is locked by another worker`);
      },
    });
    Object.defineProperty(job, 'getState', { enumerable: false, value: async () => stateOf(job.id) });
    return job;
  }
  const stateOf = (id) => { const r = jobs.get(String(id)); return r ? STATE_NAMES[r.state] : 'unknown'; };
  const isSchedulerCurrent = (rec) => {
    if (!rec || !rec.repeatJobKey) return false;
    const s = schedulers.get(rec.repeatJobKey);
    return !!s && rec.id === `repeat:${s.id}:${s.prevMillis}`;
  };

  function store({ id, jobName, data, opts, timestamp, delay, repeatJobKey }) {
    const rec = {
      id, name: jobName, data: clone(data === undefined ? {} : data), opts: clone(opts || {}), timestamp, delay: delay || 0,
      processedOn: undefined, finishedOn: undefined, attemptsMade: 0, attemptsStarted: 0, stalledCounter: 0,
      failedReason: undefined, returnvalue: undefined, repeatJobKey, deferredFailure: undefined, state: null, seq: ++seq,
    };
    jobs.set(id, rec);
    const pr = Number(rec.opts && rec.opts.priority) || 0;
    if (rec.delay > 0) place(rec, 'delayed');
    else if (paused) place(rec, 'paused');
    else if (pr > 0) place(rec, 'prioritized');
    else place(rec, 'wait');
    return rec;
  }

  function doAdd(jobName, data, opts = {}) {
    const given = opts && opts.jobId !== undefined && opts.jobId !== null && opts.jobId !== '';
    if (opts && opts.repeat) throw new Error('taggingEdgesPassFakes: legacy repeatable adds are not faked; use upsertJobScheduler');
    if (given && validateIds) {
      const why = bullmqRejects(String(opts.jobId), opts, jobName, data);
      if (why) throw new Error(why);
    }
    const id = given ? String(opts.jobId) : String(++counter);
    const t = Number.isFinite(opts.timestamp) ? opts.timestamp : now();
    if (jobs.has(id)) {
      // P2: the existing job stands; the returned Job is built from the caller's name, data and opts, so nothing in
      // the answer says it joined. Only a test can tell, through q.joins.
      joins.push({ id, name: jobName, data: safeClone(data) });
      return snapshot({
        id, name: jobName, data, opts, timestamp: t, delay: Number(opts.delay) || 0,
        attemptsMade: 0, attemptsStarted: 0, stalledCounter: 0, repeatJobKey: undefined,
      });
    }
    const rec = store({ id, jobName, data, opts: { ...opts, jobId: given ? id : undefined }, timestamp: t, delay: Number(opts.delay) || 0 });
    return snapshot(rec);
  }

  function getRange(types, asc) {
    const list = [].concat(types == null ? Object.keys(LIST_TYPES) : types);
    const t = list.map(String);
    if (t.includes('waiting')) t.push('paused');
    const seen = new Set();
    const ids = [];
    for (const type of t) {
      const key = LIST_TYPES[type];
      if (!key) continue;
      let l = lists[key].slice();
      if (key === 'delayed') l.sort((a, b) => (dueAt(jobs.get(a)) - dueAt(jobs.get(b))) || (jobs.get(a).seq - jobs.get(b).seq));
      // Redis lists read newest first (LPUSH), sets lowest score first; asc reverses the lists, as BullMQ does.
      if (key !== 'delayed' && !asc) l = l.reverse();
      if (key === 'delayed' && !asc) l = l.reverse();
      for (const id of l) if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    return ids.map((id) => snapshot(jobs.get(id)));
  }

  function createNextIteration(sched) {
    const { next, offset } = everyNextMillis(sched.prevMillis, sched.every, now(), sched.offset);
    const id = `repeat:${sched.id}:${next}`;
    if (jobs.has(id)) return null; // BullMQ emits 'duplicated' and adds nothing
    sched.prevMillis = next;
    sched.offset = offset;
    const t = now();
    const delay = Math.max(0, next - t);
    const opts = { ...(sched.opts || {}), jobId: id, delay, timestamp: t, prevMillis: next, repeatJobKey: sched.id, repeat: { every: sched.every, offset } };
    return store({ id, jobName: sched.name, data: sched.data, opts, timestamp: t, delay, repeatJobKey: sched.id });
  }

  const record = (method, args) => { calls.push({ method, args: safeClone(args) }); };

  const api = {
    name,
    calls,
    joins,
    // ── the library surface ──
    add(jobName, data, opts) { record('add', [jobName, data, opts]); return faults.run('add', () => doAdd(jobName, data, opts || {})); },
    getJobs(types, start, end, asc = false) { record('getJobs', [types, start, end, asc]); return faults.run('getJobs', () => getRange(types, asc)); },
    getActive() { record('getActive', []); return faults.run('getActive', () => getRange(['active'], true)); },
    getDelayed() { record('getDelayed', []); return faults.run('getDelayed', () => getRange(['delayed'], true)); },
    getWaiting() { record('getWaiting', []); return faults.run('getWaiting', () => getRange(['waiting'], true)); },
    getPrioritized() { record('getPrioritized', []); return faults.run('getPrioritized', () => getRange(['prioritized'], true)); },
    getJob(id) { record('getJob', [id]); return faults.run('getJob', () => snapshot(jobs.get(String(id)))); },
    getJobState(id) { record('getJobState', [id]); return faults.run('getJobState', () => stateOf(id)); },
    remove(id) {
      record('remove', [id]);
      return faults.run('remove', () => {
        const key = String(id);
        const rec = jobs.get(key);
        if (isSchedulerCurrent(rec)) throw new Error(`Job ${key} belongs to a job scheduler and cannot be removed directly. removeJob`);
        if (rec && rec.state === 'active') return 0;
        if (rec) { drop(key); jobs.delete(key); }
        return 1;
      });
    },
    upsertJobScheduler(schedulerId, repeatOpts = {}, template = {}) {
      record('upsertJobScheduler', [schedulerId, repeatOpts, template]);
      return faults.run('upsertJobScheduler', () => {
        const every = Number(repeatOpts.every);
        if (!(every > 0)) throw new Error('taggingEdgesPassFakes: only `every` job schedulers are faked');
        const existing = schedulers.get(schedulerId);
        if (existing) {
          Object.assign(existing, { name: template.name || existing.name, data: clone(template.data || existing.data), opts: clone(template.opts || existing.opts) });
          const cur = jobs.get(`repeat:${schedulerId}:${existing.prevMillis}`);
          return snapshot(cur);
        }
        const sched = { id: schedulerId, name: template.name || name, data: clone(template.data || {}), opts: clone(template.opts || {}), every, offset: 0, prevMillis: null };
        schedulers.set(schedulerId, sched);
        return snapshot(createNextIteration(sched));
      });
    },
    removeJobScheduler(schedulerId) {
      record('removeJobScheduler', [schedulerId]);
      return faults.run('removeJobScheduler', () => {
        const s = schedulers.get(schedulerId);
        if (!s) return 0;
        const cur = jobs.get(`repeat:${s.id}:${s.prevMillis}`);
        if (cur && cur.state === 'delayed') { drop(cur.id); jobs.delete(cur.id); }
        schedulers.delete(schedulerId);
        return 1;
      });
    },
    getJobSchedulers() {
      record('getJobSchedulers', []);
      return faults.run('getJobSchedulers', () => [...schedulers.values()].map((s) => ({ key: s.id, id: s.id, name: s.name, every: s.every, next: s.prevMillis })));
    },
    getJobScheduler(schedulerId) {
      record('getJobScheduler', [schedulerId]);
      return faults.run('getJobScheduler', () => {
        const s = schedulers.get(schedulerId);
        return s ? { key: s.id, id: s.id, name: s.name, every: s.every, next: s.prevMillis } : undefined;
      });
    },

    // ── controls ──
    now,
    advance(ms) { return clock.advance(ms); },
    inject(method, plan) { faults.inject(method, plan); },
    releaseHangs() { return faults.releaseHangs(); },
    pendingHangs() { return faults.pending(); },
    pause() { paused = true; for (const id of lists.wait.slice()) place(jobs.get(id), 'paused'); },
    resume() { paused = false; for (const id of lists.paused.slice()) place(jobs.get(id), 'wait'); },

    pickUp() {
      if (paused || lists.active.length >= concurrency) return null;
      const t = now();
      const due = lists.delayed.map((id) => jobs.get(id)).filter((r) => dueAt(r) <= t)
        .sort((a, b) => (dueAt(a) - dueAt(b)) || (a.seq - b.seq));
      for (const rec of due) {
        rec.delay = 0;
        if (rec.opts) rec.opts.delay = 0;
        const pr = Number(rec.opts && rec.opts.priority) || 0;
        place(rec, pr > 0 ? 'prioritized' : 'wait');
      }
      let id = lists.wait[0];
      if (id === undefined && lists.prioritized.length) {
        id = lists.prioritized.slice().sort((a, b) => ((Number(jobs.get(a).opts.priority) || 0) - (Number(jobs.get(b).opts.priority) || 0)) || (jobs.get(a).seq - jobs.get(b).seq))[0];
      }
      if (id === undefined) return null;
      const rec = jobs.get(id);
      place(rec, 'active');
      rec.processedOn = t;
      rec.attemptsStarted += 1;
      if (rec.repeatJobKey && isSchedulerCurrent(rec)) createNextIteration(schedulers.get(rec.repeatJobKey));
      const picked = snapshot(rec);
      if (rec.deferredFailure) {
        rec.failedReason = rec.deferredFailure;
        api._finish(rec, 'failed');
      }
      return picked;
    },
    _finish(rec, outcome) {
      rec.finishedOn = now();
      const removeOpt = outcome === 'completed' ? rec.opts.removeOnComplete : rec.opts.removeOnFail;
      if (outcome === 'failed') rec.attemptsMade += 1;
      if (removeOpt === true) { drop(rec.id); jobs.delete(rec.id); } else place(rec, outcome);
    },
    complete(id, returnvalue) {
      const rec = jobs.get(String(id));
      if (!rec || rec.state !== 'active') throw new Error(`taggingEdgesPassFakes: complete(${id}) needs an active job; it is ${rec ? rec.state : 'not there'}`);
      rec.returnvalue = clone(returnvalue);
      api._finish(rec, 'completed');
    },
    fail(id, error) {
      const rec = jobs.get(String(id));
      if (!rec || rec.state !== 'active') throw new Error(`taggingEdgesPassFakes: fail(${id}) needs an active job; it is ${rec ? rec.state : 'not there'}`);
      rec.failedReason = (error && error.message) || String(error);
      api._finish(rec, 'failed');
    },
    stall(id) {
      const rec = jobs.get(String(id));
      if (!rec || rec.state !== 'active') throw new Error(`taggingEdgesPassFakes: stall(${id}) needs an active job; it is ${rec ? rec.state : 'not there'}`);
      rec.stalledCounter += 1;
      if (rec.stalledCounter > maxStalledCount && !(rec.opts && rec.opts.repeat)) rec.deferredFailure = 'job stalled more than allowable limit';
      place(rec, paused ? 'paused' : 'wait', true);
    },
    work(fn) {
      const job = api.pickUp();
      if (!job) return null;
      if (job.deferredFailure) return { job, done: Promise.resolve({ outcome: 'failed', error: new Error(job.deferredFailure) }) };
      const done = Promise.resolve().then(() => fn(job)).then(
        (returnvalue) => { const r = jobs.get(job.id); if (r && r.state === 'active') api.complete(job.id, returnvalue); return { outcome: 'completed', returnvalue }; },
        (error) => { const r = jobs.get(job.id); if (r && r.state === 'active') api.fail(job.id, error); return { outcome: 'failed', error }; },
      );
      return { job, done };
    },
    plantScheduled({ entryId = SEED_ENTRY_ID, millis, every = DEFAULT_EVERY_MS, data, name: jobName } = {}) {
      const schedulerId = `sched:${entryId}`;
      const m = Number.isFinite(millis) ? millis : now();
      const offset = m - Math.floor(m / every) * every;
      const sched = { id: schedulerId, name: jobName || name, data: clone(data || { taskName: name, entryId, timeoutMs: TIMEOUT_MS }), opts: {}, every, offset, prevMillis: m };
      schedulers.set(schedulerId, sched);
      const id = `repeat:${schedulerId}:${m}`;
      const opts = { jobId: id, delay: every, timestamp: m - every, prevMillis: m, repeatJobKey: schedulerId, repeat: { every, offset } };
      store({ id, jobName: sched.name, data: sched.data, opts, timestamp: m - every, delay: every, repeatJobKey: schedulerId });
      return id;
    },

    // ── inspection ──
    state: stateOf,
    ids(state) { const key = LIST_TYPES[state] || state; return (lists[key] || []).slice(); },
    jobs: () => [...jobs.values()].map(snapshot),
    has: (id) => jobs.has(String(id)),
    scheduler: (schedulerId) => { const s = schedulers.get(schedulerId); return s ? { ...s } : undefined; },
    dump() {
      const out = {};
      for (const [k, l] of Object.entries(lists)) if (l.length) out[k] = l.slice();
      return out;
    },
  };
  return api;
}

// ─── the fake Redis, for resourceSemaphore.createSemaphore ─────────────────────────────────────────────────────────

function holdersKey(resourceClass = 'neo4j-heavy') { return `${HOLDERS_PREFIX}${resourceClass}:holders`; }

function makeFakeRedis(o = {}) {
  const hashes = new Map(); // key → Map(field → string)
  const faults = makeFaults();
  const calls = [];
  const hash = (key) => { if (!hashes.has(key)) hashes.set(key, new Map()); return hashes.get(key); };
  const r = {
    status: o.status || 'ready',
    commands: {},
    calls,
    defineCommand(cmdName, def) { calls.push({ method: 'defineCommand', args: [cmdName, { numberOfKeys: def && def.numberOfKeys }] }); r.commands[cmdName] = def; },
    /** ACQUIRE_LUA (resourceSemaphore.js): KEYS[1] = key; ARGV = leaseId, cap, ttlMs, now. */
    semaphoreAcquire(key, leaseId, cap, ttlMs, nowMs) {
      calls.push({ method: 'semaphoreAcquire', args: [key, leaseId, cap, ttlMs, nowMs] });
      return faults.run('semaphoreAcquire', () => {
        const h = hash(key);
        for (const [f, v] of [...h.entries()]) if (Number(v) < Number(nowMs)) h.delete(f);
        if (h.size < Number(cap)) { h.set(String(leaseId), String(Number(nowMs) + Number(ttlMs))); return 1; }
        return 0;
      });
    },
    hdel(key, ...fields) {
      calls.push({ method: 'hdel', args: [key, ...fields] });
      return faults.run('hdel', () => { const h = hash(key); let n = 0; for (const f of fields) if (h.delete(String(f))) n += 1; return n; });
    },
    hset(key, field, value) {
      calls.push({ method: 'hset', args: [key, field, value] });
      return faults.run('hset', () => { const h = hash(key); const had = h.has(String(field)); h.set(String(field), String(value)); return had ? 0 : 1; });
    },
    hget(key, field) { return faults.run('hget', () => { const v = hash(key).get(String(field)); return v === undefined ? null : v; }); },
    hgetall(key) { return faults.run('hgetall', () => Object.fromEntries(hash(key))); },
    hlen(key) { return faults.run('hlen', () => hash(key).size); },
    ping() { return faults.run('ping', () => 'PONG'); },
    inject(method, plan) { faults.inject(method, plan); },
    releaseHangs() { return faults.releaseHangs(); },
    holdersKey,
    holdLease({ resourceClass = 'neo4j-heavy', leaseId = 'another-task', ttlMs = 600000, expiresAt } = {}) {
      const at = Number.isFinite(expiresAt) ? expiresAt : Date.now() + ttlMs;
      hash(holdersKey(resourceClass)).set(String(leaseId), String(at));
      return leaseId;
    },
    releaseLease({ resourceClass = 'neo4j-heavy', leaseId = 'another-task' } = {}) { return hash(holdersKey(resourceClass)).delete(String(leaseId)); },
    leases(resourceClass = 'neo4j-heavy') { return Object.fromEntries(hash(holdersKey(resourceClass))); },
  };
  return r;
}

function structuredLoggingOff() {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'BRAINSTORM_STRUCTURED_LOGGING');
  const was = process.env.BRAINSTORM_STRUCTURED_LOGGING;
  process.env.BRAINSTORM_STRUCTURED_LOGGING = 'false';
  return () => { if (had) process.env.BRAINSTORM_STRUCTURED_LOGGING = was; else delete process.env.BRAINSTORM_STRUCTURED_LOGGING; };
}
async function withStructuredLoggingOff(fn) {
  const restore = structuredLoggingOff();
  try { return await fn(); } finally { restore(); }
}

// ─── what is logged, and what is signalled ─────────────────────────────────────────────────────────────────────────

/** Replace process.kill until restore(): every call is recorded and refused with ESRCH (the CT suite's guardKill). */
function guardProcessKill(o = {}) {
  const label = o.label || 'the suite';
  const real = process.kill;
  const directKills = [];
  process.kill = function guardedKill(pid, signal) {
    directKills.push({ pid, signal });
    throw Object.assign(new Error(`kill ESRCH ${pid} (refused by ${label}'s guard)`), { code: 'ESRCH' });
  };
  let restored = false;
  return {
    directKills,
    restore() { if (restored) return; restored = true; process.kill = real; },
  };
}

const STRUCTURED_EVENTS_REL = 'src/utils/structuredEvents.js';
const absPathOf = (p) => (path.isAbsolute(p) ? p : path.join(REPO, p));
function resolvedPathOf(p) {
  const abs = absPathOf(p);
  try { return require.resolve(abs); } catch (_) { return abs; }
}

/** The names src/utils/structuredEvents.js exports, read from its source text; the module is never loaded. */
function structuredEventsExportNames() {
  const names = new Set(['emitTaskEvent']);
  let src = '';
  try { src = fs.readFileSync(path.join(REPO, STRUCTURED_EVENTS_REL), 'utf8'); } catch (_) { return [...names]; }
  const whole = /module\.exports\s*=\s*\{([^}]*)\}/.exec(src);
  if (whole) {
    for (const part of whole[1].split(',')) {
      const n = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
    }
  }
  for (const m of src.matchAll(/(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) names.add(m[1]);
  return [...names];
}

/** The real module's scriptName rule: the first stack frame outside this file and outside structuredEvents.js. */
function callerScriptName() {
  try {
    const lines = String(new Error().stack || '').split('\n');
    for (let i = 1; i < lines.length; i += 1) {
      const m = lines[i].match(/\(([^)]+):\d+:\d+\)/) || lines[i].match(/at ([^\s]+):\d+:\d+/);
      if (m && m[1] && m[1] !== __filename && !m[1].endsWith('structuredEvents.js')) return path.basename(m[1]);
    }
  } catch (_) { /* fall through */ }
  return require.main && require.main.filename ? path.basename(require.main.filename) : 'node';
}

/** A recording stand-in for src/utils/structuredEvents.js in require's cache, until rec.restore(). */
function recordStructuredEvents(o = {}) {
  const Module = require('module');
  const now = typeof o.now === 'function' ? o.now : Date.now;
  const file = resolvedPathOf(STRUCTURED_EVENTS_REL);
  const savedEntry = require.cache[file];
  const forgotten = new Map();
  for (const p of [].concat(o.forget || [])) {
    const r = resolvedPathOf(p);
    if (r === file || forgotten.has(r)) continue;
    forgotten.set(r, require.cache[r]);
    delete require.cache[r];
  }
  const events = [];
  const calls = [];
  const lines = [];
  const stubExports = {};
  for (const fnName of structuredEventsExportNames()) {
    stubExports[fnName] = function recordedStructuredEvent(...args) {
      const [type, taskName, target, meta] = args;
      calls.push({ fn: fnName, args: safeClone(args) });
      events.push({ type, taskName, target, meta: safeClone(meta) || {} });
      lines.push({
        timestamp: iso(now()),
        eventType: type || 'UNKNOWN',
        taskName: taskName || '',
        target: target || '',
        metadata: safeClone(meta) || {},
        scriptName: callerScriptName(),
        pid: process.pid,
      });
      return undefined;
    };
  }
  const entry = new Module(file, null);
  entry.filename = file;
  entry.loaded = true;
  entry.exports = stubExports;
  try { entry.paths = Module._nodeModulePaths(path.dirname(file)); } catch (_) { /* not needed */ }
  require.cache[file] = entry;
  let restored = false;
  const jsonl = () => lines.map((l) => `${JSON.stringify(l)}\n`).join('');
  return {
    file,
    events,
    calls,
    lines,
    jsonl,
    text: () => JSON.stringify({ events, calls, lines }),
    writeJsonl(logDir) {
      const dir = String(logDir || '');
      if (!path.isAbsolute(dir)) throw new Error(`writeJsonl needs an absolute log directory; got ${brief(logDir)}`);
      const norm = path.resolve(dir);
      for (const live of ['/var/log/brainstorm', '/var/lib/brainstorm']) {
        if (norm === live || norm.startsWith(`${live}/`)) throw new Error(`writeJsonl refuses ${norm}: tests never write under ${live}`);
      }
      const out = path.join(norm, 'taskQueue', 'events.jsonl');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, jsonl());
      return out;
    },
    restore() {
      if (restored) return;
      restored = true;
      // Put the earlier entry back unless something else has since put its own stand-in there.
      if (require.cache[file] === entry || require.cache[file] === undefined) {
        if (savedEntry) require.cache[file] = savedEntry; else delete require.cache[file];
      }
      for (const [r, was] of forgotten) {
        if (was) require.cache[r] = was; else delete require.cache[r];
      }
    },
  };
}

const CONSOLE_METHODS = Object.freeze(['log', 'info', 'warn', 'error', 'debug', 'trace']);
function argsAsJson(args) {
  try {
    return JSON.stringify(args, (k, v) => (v instanceof Error ? { name: v.name, message: v.message, code: v.code, stack: v.stack } : v));
  } catch (_) {
    return args.map((a) => String(a)).join(' ');
  }
}

/** Wrap console's methods until cap.restore(), keeping each call's printed text and its arguments as JSON. */
function captureConsole(o = {}) {
  const util = require('util');
  const methods = [].concat(o.methods || CONSOLE_METHODS);
  const saved = {};
  const lines = [];
  for (const m of methods) {
    saved[m] = console[m];
    console[m] = function capturedConsole(...args) {
      let text;
      try { text = util.format(...args); } catch (_) { text = args.map((a) => String(a)).join(' '); }
      if (m === 'trace') text = `Trace: ${text}`;
      lines.push({ level: m, text, json: argsAsJson(args) });
      if (o.passThrough && typeof saved[m] === 'function') saved[m].apply(console, args);
    };
  }
  let restored = false;
  return {
    lines,
    text: () => lines.map((l) => `${l.text}\n${l.json}`).join('\n'),
    restore() {
      if (restored) return;
      restored = true;
      for (const m of methods) console[m] = saved[m];
    },
  };
}

/** The real semaphore (resourceSemaphore.js, required now) over a fake Redis, with short polls and a short give-up. */
function makeSemaphore(redis, o = {}) {
  const mod = loadModule(MODULES.semaphore, { createSemaphore: 'function' }, adr('D4'));
  return mod.createSemaphore(redis, o.caps || { 'neo4j-heavy': 1 }, {
    pollIntervalMs: o.pollIntervalMs || 5,
    acquireTimeoutMs: o.acquireTimeoutMs || 150,
    leaseTtlMs: o.leaseTtlMs,
  });
}

/** D4's contract, scripted: polls shouldAbandon (→ null), wins while `free` (→ release), else gives up. */
function makeScriptedSemaphore(o = {}) {
  const sem = {
    free: o.free !== false,
    calls: [],
    releases: 0,
    async acquire(resourceClass, ctx = {}) {
      const call = { resourceClass, ctx, outcome: null };
      sem.calls.push(call);
      const start = Date.now();
      for (;;) {
        if (typeof ctx.shouldAbandon === 'function' && ctx.shouldAbandon()) { call.outcome = 'abandoned'; return null; }
        if (sem.free) {
          if (typeof ctx.shouldAbandon === 'function' && ctx.shouldAbandon()) { call.outcome = 'abandoned'; return null; }
          sem.free = false;
          call.outcome = 'acquired';
          let released = false;
          return async () => { if (released) return; released = true; sem.releases += 1; sem.free = true; };
        }
        if (Date.now() - start >= (o.acquireTimeoutMs || 150)) {
          call.outcome = 'timeout';
          throw Object.assign(new Error(`Could not acquire resource class "${resourceClass}" (scripted). ${WAIT_TIMEOUT_CODE}.`), { code: WAIT_TIMEOUT_CODE });
        }
        // eslint-disable-next-line no-await-in-loop
        await sleep(o.pollIntervalMs || 5);
      }
    },
  };
  return sem;
}

// ─── report, confirmation and /proc builders ───────────────────────────────────────────────────────────────────────

const PHASES = Object.freeze(['identities', 'schema', 'graph-read', 'relay-read', 'plan']);
const STOPPED_REASON = 'stopped before it finished (time-out, deploy or restart)';
let hexSeq = 0;
const nextHex8 = () => (0xc0000000 + (++hexSeq)).toString(16).slice(-8);

function runIdAt(when, hex8) {
  const d = new Date(typeof when === 'number' ? when : Date.parse(when));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z-${hex8 || nextHex8()}`;
}

function phaseEntries(o) {
  let names = o.phases;
  if (!names && o.through) names = PHASES.slice(0, PHASES.indexOf(o.through) + 1);
  return (names || []).map((n) => ({ phase: n, ms: 100, batches: 0, transientRetries: 0 }));
}

const ENDINGS = {
  done: { outcome: 'done', reasonCode: 'done', reason: 'the graph agrees with the relay', stopped: false, failure: null },
  'done-removals-held': { outcome: 'done-removals-held', reasonCode: 'removals-held', reason: 'removals held: 60 over the limit; the owner can confirm them', stopped: false, failure: null },
  stopped: { outcome: 'stopped', reasonCode: 'requested', reason: 'stopped on request at a safe point', stopped: true, failure: null },
  failed: { outcome: 'failed', reasonCode: 'error', reason: 'an unexpected error ended the pass', stopped: false, failure: { stage: 'unexpected', code: 'error', message: 'injected' } },
  refused: { outcome: 'refused', reasonCode: 'identity', reason: 'the canonical stamp identity is missing (source: env)', stopped: false, failure: { stage: 'identity', identity: 'canonical', problem: 'missing', source: 'env', code: 'missing', message: 'the canonical stamp identity (source env) is missing' } },
};

/** A report.json record in the pass's shape (reconcileTaggingEdges.js pessimisticRecord, then finish()). */
function passRecord(o = {}) {
  const state = o.state || 'running';
  const startedMs = o.startedAt !== undefined ? Date.parse(o.startedAt) : T0;
  const startedAt = iso(startedMs);
  const runId = o.runId || runIdAt(startedMs, o.hex);
  const rec = {
    runId,
    startedAt,
    endedAt: null,
    durationMs: null,
    outcome: 'failed',
    reasonCode: 'stopped',
    reason: STOPPED_REASON,
    stopped: true,
    failure: null,
    confirmed: null,
    confirmation: { found: false, honoured: false, ...(o.confirmation || {}) },
    taggingsRead: 0,
    tagElementsRead: 0,
    held: { total: 0, byReason: {}, digest: null },
    phases: phaseEntries(o),
    running: true,
    process: { pid: o.pid || 4242, startTime: String(o.startTime || '987654321') },
  };
  if (!o.preStory6) rec.job = typeof o.jobId === 'string' ? { id: o.jobId } : null;
  if (state !== 'running' && state !== 'killed') {
    const end = ENDINGS[state];
    if (!end) throw new Error(`taggingEdgesPassFakes.passRecord: unknown state ${state}`);
    const endedMs = o.endedAt !== undefined ? Date.parse(o.endedAt) : startedMs + 3000;
    Object.assign(rec, clone(end), { endedAt: iso(endedMs), durationMs: endedMs - startedMs, running: false });
  }
  return Object.assign(rec, o.over || {});
}
function reportOf(latest, previous = []) { return { reportVersion: 1, latest, previous }; }

function nonceOf(label) { return crypto.createHash('sha256').update(`nonce:${label}`, 'utf8').digest('hex').slice(0, 32); }
function claimedName(runId, nonce = nonceOf(runId)) { return `${runId}-${nonce}.json`; }
/** A pending confirmation.json as the confirm route writes it. */
function confirmationRecord(o = {}) {
  const mintedAt = o.mintedAt || iso(T0 - 60000);
  return {
    version: 1,
    runId: o.runId || '20261027T110000Z-0a1b2c3d',
    heldDigest: o.heldDigest || 'd'.repeat(64),
    heldCount: o.heldCount || 60,
    nonce: o.nonce || nonceOf(o.runId || 'pending'),
    mintedAt,
    expiresAt: iso(Date.parse(mintedAt) + 24 * 60 * 60 * 1000),
    mintedBy: OWNER_KEY,
  };
}

/** A /proc/<pid>/stat line: field 22 (starttime) is `start` (test/tagging-edges-state-routes.test.js statLine). */
function statLine({ pid, comm = 'node', state = 'S', start }) {
  const after = [state, 1, pid, pid, 0, -1, 4194560, 1200, 0, 3, 0, 150, 30, 0, 0, 20, 0, 11, 0, start, 1234567168, 25000,
    '18446744073709551615', 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 17, 3, 0, 0, 0, 0, 0];
  return `${pid} (${comm}) ${after.join(' ')}\n`;
}
const procStat = (pid, o = {}) => ({ [`/proc/${pid}/stat`]: statLine({ pid, ...o }) });

/** An injected readFile: /proc paths from `proc` only (an object, or a function returning one), never the host's. */
function makeReadFile(proc = {}) {
  const calls = [];
  function readFile(p, ...rest) {
    const cb = rest.length && typeof rest[rest.length - 1] === 'function' ? rest.pop() : null;
    calls.push(typeof p === 'number' ? `fd:${p}` : String(p));
    const table = typeof proc === 'function' ? proc() : proc;
    const opt = rest[0];
    const enc = typeof opt === 'string' ? opt : (opt && typeof opt === 'object' && opt.encoding) || null;
    let out;
    let err = null;
    try {
      const key = String(p);
      if (Object.prototype.hasOwnProperty.call(table, key)) out = enc ? table[key] : Buffer.from(table[key], 'utf8');
      else if (key.startsWith('/proc/')) {
        throw Object.assign(new Error(`ENOENT: no such file or directory, open '${key}'`), { code: 'ENOENT', errno: -2, syscall: 'open', path: key });
      } else out = fs.readFileSync(p, ...rest);
    } catch (e) { err = e; }
    if (cb) { process.nextTick(cb, err, out); return undefined; }
    if (err) throw err;
    return out;
  }
  readFile.calls = calls;
  return readFile;
}

/** A process table standing in for /proc: isAlive(record) follows state.isAlive's rule. */
function makeProcs() {
  const table = new Map(); // pid → { startTime: string, state }
  const procs = {
    spawn(pid, startTime) { table.set(pid, { startTime: String(startTime), state: 'S' }); return { pid, startTime: String(startTime) }; },
    exit(pid) { table.delete(pid); },
    zombie(pid) { const p = table.get(pid); if (p) p.state = 'Z'; },
    reuse(pid, startTime) { table.set(pid, { startTime: String(startTime), state: 'S' }); },
    alive(pid) { const p = table.get(pid); return !!p && p.state !== 'Z' && p.state !== 'X'; },
    isAlive(record) {
      const proc = record && record.process && typeof record.process === 'object' ? record.process : record;
      if (!proc || !Number.isInteger(proc.pid) || proc.pid <= 0 || proc.startTime == null) return false;
      const p = table.get(proc.pid);
      return !!p && p.state !== 'Z' && p.state !== 'X' && String(p.startTime) === String(proc.startTime);
    },
    statFiles() {
      const out = {};
      for (const [pid, p] of table) Object.assign(out, procStat(pid, { state: p.state, start: p.startTime }));
      return out;
    },
    table,
  };
  procs.readFile = makeReadFile(() => procs.statFiles());
  return procs;
}

/** A temp state directory (never /var/lib/brainstorm): { dir, controlDir, recordFile, useAsEnv(), cleanup() }. */
function makeTempStateDir(label = 'pass') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `tagging-edges-${String(label).replace(/[^A-Za-z0-9_-]/g, '-')}-`));
  if (dir.startsWith('/var/lib/brainstorm')) throw new Error(`refusing a state directory under /var/lib/brainstorm: ${dir}`);
  return {
    dir,
    controlDir: path.join(dir, 'control'),
    recordFile: path.join(dir, 'control', 'record.json'),
    useAsEnv() {
      const had = Object.prototype.hasOwnProperty.call(process.env, 'TAGGING_EDGES_STATE_DIR');
      const was = process.env.TAGGING_EDGES_STATE_DIR;
      process.env.TAGGING_EDGES_STATE_DIR = dir;
      return () => { if (had) process.env.TAGGING_EDGES_STATE_DIR = was; else delete process.env.TAGGING_EDGES_STATE_DIR; };
    },
    cleanup() { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ } },
  };
}

// ─── the record (D11), in memory ───────────────────────────────────────────────────────────────────────────────────

function whoOf(kind, pubkey) {
  if (kind === 'owner') return { kind, key: (pubkey || OWNER).slice(0, 8) };
  if (kind === 'admin') return { kind, key: (pubkey || ADMIN).slice(0, 8) };
  return { kind };
}
function recordEntry(o = {}) {
  return {
    jobId: o.jobId === undefined ? null : o.jobId,
    start: o.start || null,
    stop: o.stop || null,
    skip: !!o.skip,
    noRerun: !!o.noRerun,
    gaveUpAt: o.gaveUpAt || null,
  };
}
function historyLine(action, key, at, who) { return { action, key, at, who }; }
function recordFile({ passes = {}, history = [] } = {}) { return { version: 1, passes, history }; }

function makeRecordStore(o = {}) {
  let gate = null;
  const s = {
    text: o.text !== undefined ? o.text : (o.record ? `${JSON.stringify(o.record, null, 2)}\n` : null),
    readError: o.readError || null,
    writeError: o.writeError || null,
    renameError: o.renameError || null,
    writes: [],
    renames: [],
    damaged: [],
    read() {
      if (s.readError) return { unreadable: true, readError: s.readError };
      if (s.text === null) return null;
      try {
        const v = JSON.parse(s.text);
        if (!v || typeof v !== 'object' || Array.isArray(v)) return { damaged: true };
        return v;
      } catch (_) {
        return { damaged: true };
      }
    },
    write(rec) {
      const perform = () => {
        if (s.writeError) throw errorWithCode(s.writeError);
        s.text = `${JSON.stringify(rec, null, 2)}\n`;
        s.writes.push(clone(rec));
      };
      if (gate) return gate.then(perform);
      perform();
      return undefined;
    },
    rename(...args) {
      if (s.renameError) throw errorWithCode(s.renameError);
      s.renames.push(safeClone(args));
      s.damaged.push({ args: safeClone(args), text: s.text });
      s.text = null;
    },
    bytes: () => s.text,
    parsed: () => (s.text === null ? null : JSON.parse(s.text)),
    set(rec) { s.text = rec === null ? null : `${JSON.stringify(rec, null, 2)}\n`; },
    setText(text) { s.text = text; },
    failReads(code = 'EIO') { s.readError = code; },
    failWrites(code = 'ENOSPC') { s.writeError = code; },
    failRenames(code = 'EIO') { s.renameError = code; },
    heal() { s.readError = null; s.writeError = null; s.renameError = null; },
    gateWrites() { let open; gate = new Promise((r) => { open = r; }); s._open = open; },
    releaseWrites() { const open = s._open; gate = null; s._open = null; if (open) open(); },
  };
  return s;
}

// ─── the world and the controller's deps ───────────────────────────────────────────────────────────────────────────

function makeWorld(o = {}) {
  const clock = o.clock || makeClock(o.now === undefined ? T0 : o.now);
  const queue = o.queue || makeFakeQueue({ clock });
  const procs = o.procs || makeProcs();
  const record = o.recordStore || makeRecordStore(o.record || {});
  const calls = [];
  let seq = 0;
  let tempDir = null;
  let keyN = 0;
  let pidN = 5000;
  const endListeners = [];

  function spy(name, impl) {
    const f = function spied(...args) {
      const entry = { seq: ++seq, name, args: safeClone(args) };
      calls.push(entry);
      f.calls.push(entry);
      return impl.apply(this, args);
    };
    f.calls = [];
    f.spyName = name;
    return f;
  }

  const world = {
    clock,
    queue,
    procs,
    record,
    calls,
    keys: [],
    kills: [],
    report: o.report === undefined ? null : o.report,
    reportError: null,
    confirmation: o.confirmation === undefined ? null : o.confirmation,
    confirmationError: null,
    claimed: new Set(o.claimed || []),
    health: o.health || 'ready',
    enabled: o.enabled !== false,
    owner: o.owner || OWNER,
    admins: o.admins || [ADMIN],
    killError: null,
    stopOnSignal: !!o.stopOnSignal,
    onKill: null,
    names: () => calls.map((c) => c.name),
    callsOf: (name) => calls.filter((c) => c.name === name),
    resetCalls: () => { calls.length = 0; },
    stateDirPath() {
      if (o.stateDir) return o.stateDir;
      if (!tempDir) tempDir = makeTempStateDir('pass-world');
      return tempDir.dir;
    },
    onPassEnd(fn) { endListeners.push(fn); },

    startPass(p = {}) {
      const pid = p.pid || (pidN += 1);
      const startTime = String(p.startTime || (900000000 + pid));
      procs.spawn(pid, startTime);
      const rec = passRecord({ ...p, pid, startTime, state: 'running', startedAt: p.startedAt || clock.iso() });
      const r = world.report;
      const previous = r ? [r.latest, ...(r.previous || [])].filter(Boolean).slice(0, 9) : [];
      world.report = reportOf(rec, previous);
      return rec;
    },
    endPass(p = {}) {
      const latest = world.report && world.report.latest;
      if (!latest) throw new Error('taggingEdgesPassFakes.endPass: no latest run');
      const end = ENDINGS[p.state || 'done'];
      if (!end) throw new Error(`taggingEdgesPassFakes.endPass: unknown state ${p.state}`);
      const endedMs = p.endedAt !== undefined ? Date.parse(p.endedAt) : clock.now();
      Object.assign(latest, clone(end), { endedAt: iso(endedMs), durationMs: endedMs - Date.parse(latest.startedAt), running: false }, p.over || {});
      if (latest.process) procs.exit(latest.process.pid);
      for (const fn of endListeners.slice()) fn(latest);
      return latest;
    },
    setPhases(names) { world.report.latest.phases = phaseEntries({ phases: names }); },
    claim(runId, c = {}) {
      const pending = world.confirmation;
      world.claimed.add(claimedName(runId, (pending && pending.nonce) || nonceOf(runId)));
      world.confirmation = null;
      if (c.save && world.report && world.report.latest && world.report.latest.runId === runId) world.report.latest.confirmation = { found: true, honoured: false };
    },
    cleanup() { if (tempDir) tempDir.cleanup(); tempDir = null; },
  };

  world.deps = {
    now: () => clock.now(),
    randomKey: spy('randomKey', () => { const k = lineUpKey(keyN += 1); world.keys.push(k); return k; }),
    stateDir: () => world.stateDirPath(),
    readReport: spy('readReport', () => { if (world.reportError) throw errorWithCode(world.reportError); return clone(world.report); }),
    readConfirmation: spy('readConfirmation', () => { if (world.confirmationError) throw errorWithCode(world.confirmationError); return clone(world.confirmation); }),
    isAlive: spy('isAlive', (rec) => procs.isAlive(rec)),
    listClaimed: spy('listClaimed', (runId) => [...world.claimed].filter((n) => n.startsWith(`${runId}-`)).sort()),
    queueHealth: spy('queueHealth', () => world.health),
    taskQueueEnabled: spy('taskQueueEnabled', () => world.enabled),
    queue: {
      getDelayed: spy('queue.getDelayed', (...a) => queue.getDelayed(...a)),
      getJobs: spy('queue.getJobs', (...a) => queue.getJobs(...a)),
      getActive: spy('queue.getActive', (...a) => queue.getActive(...a)),
      add: spy('queue.add', (...a) => queue.add(...a)),
    },
    kill: spy('kill', (pid, signal) => {
      if (!procs.alive(pid)) throw Object.assign(new Error(`kill ESRCH ${pid}`), { code: 'ESRCH', errno: -3, syscall: 'kill' });
      if (world.killError) throw errorWithCode(world.killError);
      world.kills.push({ pid, signal });
      if (typeof world.onKill === 'function') world.onKill(pid, signal);
      if (world.stopOnSignal && signal === 'SIGTERM') {
        const latest = world.report && world.report.latest;
        if (latest && latest.process && latest.process.pid === pid && latest.endedAt == null) world.endPass({ state: 'stopped' });
      }
      return true;
    }),
    readRecord: spy('readRecord', () => record.read()),
    writeRecord: spy('writeRecord', (rec) => record.write(rec)),
    renameRecord: spy('renameRecord', (...a) => record.rename(...a)),
    ownerPubkey: () => world.owner,
    getAdminPubkeys: () => world.admins.slice(),
    timers: { ...FAST_TIMERS, ...(o.timers || {}) },
  };
  return world;
}

/** D3's worker callback, as the ADR writes it. */
function adrWorkerCallback({ gate, semaphore, processor, taskName = TASK, resourceClass = 'neo4j-heavy', taskDef = {} }) {
  return async (job) => {
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
        if (err && err.code === WAIT_TIMEOUT_CODE) await gate.gaveUp(job, err);
        throw err;
      }
      if (!release) return gate.skipped(job);
      if ((await gate.afterAcquire(job)) === 'skip') return gate.skipped(job);
      return await processor.processJob(job, taskDef);
    } finally {
      if (release) await release();
      gate.ended(job);
    }
  };
}

/** A processor whose processJob starts a run in `world` under the job's id and settles when that run ends. */
function makeFakeProcessor(world, o = {}) {
  const calls = [];
  const pending = new Map(); // runId → { resolve, jobId }
  world.onPassEnd((latest) => {
    const p = pending.get(latest.runId);
    if (p) { pending.delete(latest.runId); p.resolve({ success: latest.outcome !== 'failed' && latest.outcome !== 'refused', exitCode: 0, outcome: latest.outcome }); }
  });
  return {
    calls,
    async processJob(job, taskDef) {
      calls.push({ jobId: job && job.id, taskDef });
      if (o.writesNoReport) return { success: false, exitCode: 0, noReport: true };
      const rec = world.startPass({ ...(o.pass || {}), jobId: String(job.id) });
      return new Promise((resolve) => { pending.set(rec.runId, { resolve, jobId: String(job.id) }); });
    },
    end(jobId, endOpts = {}) {
      const latest = world.report && world.report.latest;
      if (!latest || !latest.job || latest.job.id !== jobId) throw new Error(`taggingEdgesPassFakes: no running pass for job ${jobId}`);
      return world.endPass(endOpts);
    },
    running: (jobId) => [...pending.values()].some((p) => p.jobId === jobId),
  };
}

// ─── requests ──────────────────────────────────────────────────────────────────────────────────────────────────────

function fakeReq({ method = 'POST', url = '', session, localTrusted, headers = {}, body, query = {} } = {}) {
  const h = {};
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && v !== null) h[k.toLowerCase()] = v;
  const req = {
    method, url, originalUrl: url, path: url.split('?')[0], headers: h, body, query, session,
    hostname: String(h.host || '').split(':')[0], protocol: 'http', secure: false, ip: '203.0.113.9',
    get(n) { return h[String(n).toLowerCase()]; },
    header(n) { return h[String(n).toLowerCase()]; },
    is(...types) {
      const ct = String(h['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (!ct) return false;
      const [x, y] = ct.split('/');
      for (const t of types.flat()) {
        const want = String(t).includes('/') ? String(t).toLowerCase()
          : ({ json: 'application/json', urlencoded: 'application/x-www-form-urlencoded', multipart: 'multipart/*', text: 'text/*' })[t] || `*/${t}`;
        const [a, b] = want.split('/');
        if ((a === '*' || a === x) && (b === '*' || b === y)) return t;
      }
      return false;
    },
  };
  if (localTrusted !== undefined) req.localTrusted = localTrusted;
  return req;
}

const SESSIONS = {
  owner: () => ({ authenticated: true, pubkey: OWNER }),
  admin: () => ({ authenticated: true, pubkey: ADMIN }),
  stranger: () => ({ authenticated: true, pubkey: STRANGER }),
  unauthenticated: () => ({ authenticated: false, pubkey: OWNER }),
  'signed-out': () => undefined,
  local: () => undefined,
};

function passReq(as = 'owner', o = {}) {
  if (!Object.prototype.hasOwnProperty.call(SESSIONS, as)) throw new Error(`taggingEdgesPassFakes.passReq: unknown caller ${as}`);
  const method = o.method || 'POST';
  const url = o.path || PATHS.run;
  const headers = { host: HOST, ...(o.headers || {}) };
  const origin = o.origin === undefined ? undefined : (ORIGINS[o.origin] || o.origin);
  if (origin !== undefined) headers.origin = origin;
  if (method !== 'GET' && method !== 'HEAD') {
    if (o.contentType !== null) headers['content-type'] = o.contentType || 'application/json';
  }
  const body = Object.prototype.hasOwnProperty.call(o, 'body') ? o.body : (method === 'GET' || method === 'HEAD' ? undefined : {});
  return fakeReq({
    method, url, headers, body, query: o.query || {},
    session: SESSIONS[as](),
    localTrusted: as === 'local' ? true : o.localTrusted,
  });
}

function fakeRes() {
  const res = { statusCode: 200, body: undefined, finished: false, headers: {} };
  let done;
  res.done = new Promise((r) => { done = r; });
  const finish = (b) => {
    if (res.finished) return res;
    res.finished = true;
    if (typeof b === 'string') { try { res.body = JSON.parse(b); } catch (_) { res.body = b; } } else res.body = b;
    done();
    return res;
  };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => finish(b);
  res.send = (b) => finish(b);
  res.end = (b) => finish(b);
  res.sendStatus = (c) => { res.statusCode = c; return finish(undefined); };
  res.set = (k, v) => { res.headers[String(k).toLowerCase()] = v; return res; };
  res.setHeader = res.set;
  res.header = res.set;
  res.type = () => res;
  return res;
}

/** Call a handler; wait for its answer. → { res, status, body, rejected } (rejected: what it rejected with, else null). */
async function callHandler(fn, req, deps, { timeoutMs = 3000 } = {}) {
  const res = fakeRes();
  let rejected = null;
  try { await fn(req, res, deps); } catch (e) { rejected = e || new Error('rejected with nothing'); }
  if (!res.finished) {
    let timer;
    await Promise.race([res.done, new Promise((r) => { timer = setTimeout(r, timeoutMs); })]);
    clearTimeout(timer);
  }
  if (!res.finished) throw new Error(`the handler never answered within ${timeoutMs} ms${rejected ? ` (it rejected: ${firstLine(rejected)})` : ''}`);
  return { res, status: res.statusCode, body: res.body, rejected };
}

// ─── self-check ────────────────────────────────────────────────────────────────────────────────────────────────────

async function selfCheck() {
  const checks = [];
  const check = (n, fn) => checks.push([n, fn]);
  const ok = (cond, msg) => { if (!cond) throw new Error(msg); };
  const throwsWith = async (fn, re, what) => {
    let err = null;
    try { await fn(); } catch (e) { err = e; }
    ok(err, `${what}: expected a throw matching ${re}, got none`);
    ok(re.test(String(err.message)), `${what}: expected ${re}, got ${firstLine(err)}`);
    return err;
  };

  check('loader: a missing module, a missing export and a present one', async () => {
    const e1 = await throwsWith(() => loadModule('src/pipeline/tagging-edges/control/__absent__.js', ['createController'], adr('D1')), /does not exist yet \(ADR tagging-edges\/0006 D1\).*createController/, 'missing module');
    ok(e1 instanceof AssertionError, 'a missing module throws an AssertionError');
    const e2 = await throwsWith(() => loadModule(MODULES.state, { isAlive: 'function', notThere: 'function' }, adr('D5')), /does not export notThere\(\) yet \(ADR tagging-edges\/0006 D5\)/, 'missing export');
    ok(e2 instanceof AssertionError, 'a missing export throws an AssertionError');
    await throwsWith(() => loadModule(MODULES.state, { stateDir: 'object' }, adr('D11')), /stateDir as a object \(it is a function\)/, 'wrong type');
    const st = loadModule(MODULES.state, ['isAlive', 'stateDir'], adr('D5'));
    ok(typeof st.isAlive === 'function', 'a present module comes back');
  });

  check("P1: BullMQ's own rule — LINEUP_ID's form and the legacy id pass, one ':' and digits are refused, the fake add follows it", async () => {
    ok(LINEUP_ID.test(lineUpKey(7)), `lineUpKey(7) matches LINEUP_ID: ${lineUpKey(7)}`);
    ok(bullmqRejects(lineUpKey(7)) === null, `BullMQ accepts ${lineUpKey(7)}: ${bullmqRejects(lineUpKey(7))}`);
    ok(bullmqRejects(LEGACY_ID) === null, 'BullMQ accepts the legacy fixed id');
    ok(/cannot contain :/i.test(String(bullmqRejects(`${TASK}:abc`))), 'BullMQ refuses one colon');
    ok(/integer/i.test(String(bullmqRejects('12345'))), 'BullMQ refuses an all-digit id');
    ok(bullmqRejects('a:b:c') === null, 'BullMQ lets a three-part id through');
    const q = makeFakeQueue();
    await throwsWith(() => q.add(TASK, lineUpData(), lineUpOpts(`${TASK}:abc`)), /Custom Id cannot contain :/, 'fake add with one colon');
    ok(q.jobs().length === 0, 'a refused add stores nothing');
  });

  check('P2: a unique id waits behind an active job; a re-add of an existing id joins with the caller data returned and the stored data unchanged', async () => {
    const q = makeFakeQueue();
    const a = await q.add(TASK, { n: 'A' }, lineUpOpts(lineUpKey(1)));
    ok(q.pickUp().id === a.id && q.state(a.id) === 'active', 'A is active');
    const b = await q.add(TASK, { n: 'B' }, lineUpOpts(lineUpKey(2)));
    ok(q.state(b.id) === 'waiting', `B waits, got ${q.state(b.id)}`);
    const again = await q.add(TASK, { n: 'caller' }, lineUpOpts(lineUpKey(1)));
    ok(again.id === a.id && again.data.n === 'caller', `the join answers A's id with the caller's data: ${brief(again)}`);
    ok(!Object.prototype.hasOwnProperty.call(again, 'joined') && again.processedOn === undefined, 'nothing in the answer says it joined');
    const stored = await q.getJob(a.id);
    ok(stored.data.n === 'A', 'the stored data is unchanged');
    ok(q.jobs().length === 2 && q.joins.length === 1, 'nothing new was stored; the test can see the join');
    ok(q.pickUp() === null, 'concurrency 1: nothing else is picked up while A is active');
  });

  check('P5: an active job cannot be removed — remove answers 0 and job.remove() throws "locked by another worker"; a waiting one is removed', async () => {
    const q = makeFakeQueue();
    await q.add(TASK, {}, lineUpOpts(lineUpKey(1)));
    const a = q.pickUp();
    ok((await q.remove(a.id)) === 0, 'remove of the active job answers 0');
    await throwsWith(() => a.remove(), /locked by another worker/, 'job.remove() of the active job');
    const b = await q.add(TASK, {}, lineUpOpts(lineUpKey(2)));
    ok((await q.remove(b.id)) === 1 && !q.has(b.id), 'a waiting job is removed');
    ok((await q.remove('not-there')) === 1, 'an id that is not there answers 1, as BullMQ does');
  });

  check("Q2: a scheduled run that comes due while another job is active stays delayed, and remove throws 'belongs to a job scheduler'", async () => {
    const q = makeFakeQueue();
    const M = T0 + 60000;
    const sid = q.plantScheduled({ millis: M, every: 3000 });
    ok(sid === `repeat:sched:${SEED_ENTRY_ID}:${M}` && millisOf(sid) === M, `the seed form, with its millis: ${sid}`);
    await q.add(TASK, {}, lineUpOpts(lineUpKey(1)));
    q.pickUp();
    q.advance(120000);
    const delayed = (await q.getDelayed()).map((j) => j.id);
    ok(delayed.includes(sid), `past due, still delayed: ${brief(q.dump())}`);
    const j = (await q.getDelayed()).find((x) => x.id === sid);
    ok(j.timestamp + j.delay === M && j.repeatJobKey === `sched:${SEED_ENTRY_ID}`, `timestamp + delay is its millis: ${brief(j)}`);
    const waiting = (await q.getJobs(['waiting', 'paused', 'prioritized'])).map((x) => x.id);
    ok(!waiting.includes(sid), 'it is not in wait');
    await throwsWith(() => q.remove(sid), /belongs to a job scheduler and cannot be removed directly/, 'remove of the current scheduled job');
  });

  check('Q3: picked up late, the scheduled job makes the next run at its usual slot; the picked job is no longer the current one', async () => {
    const clock = makeClock(T0);
    const q = makeFakeQueue({ clock });
    const M = T0 + 1165;
    const sid = q.plantScheduled({ millis: M, every: 3000 });
    clock.set(M + 1200);
    const picked = q.pickUp();
    ok(picked && picked.id === sid && picked.processedOn === M + 1200, `the due run is picked up: ${brief(picked)}`);
    const next = `repeat:sched:${SEED_ENTRY_ID}:${M + 3000}`;
    ok(q.state(next) === 'delayed', `next run ${next} is delayed: ${brief(q.dump())}`);
    const sched = (await q.getJobSchedulers())[0];
    ok(sched.next === M + 3000, `the scheduler's next is the usual slot: ${brief(sched)}`);
    ok((await q.remove(sid)) === 0, 'the active scheduled job answers 0, not a scheduler throw');
    clock.set(M + 3000 + 50000);
    q.complete(sid);
    ok(q.state(sid) === 'completed', 'a scheduled job without removeOnComplete stays completed');
    const late = q.pickUp();
    const catchUp = Math.floor((M + 53000) / 3000) * 3000 + 3000 + ((M + 3000) % 3000);
    ok(late.id === next && q.state(`repeat:sched:${SEED_ENTRY_ID}:${catchUp}`) === 'delayed', `BullMQ's catch-up slot ${catchUp}: ${brief(q.dump())}`);
  });

  check('waiting order, promotion and getJobs type names', async () => {
    const clock = makeClock(T0);
    const q = makeFakeQueue({ clock });
    await q.add(TASK, {}, lineUpOpts(lineUpKey(1)));
    q.pickUp();
    const sid = q.plantScheduled({ millis: T0 + 10, every: 3000 });
    const b = await q.add(TASK, {}, lineUpOpts(lineUpKey(2)));
    clock.advance(100);
    q.complete(lineUpKey(1));
    ok(!q.has(lineUpKey(1)), 'removeOnComplete deletes the job');
    const again = await q.add(TASK, { fresh: true }, lineUpOpts(lineUpKey(1)));
    ok(q.joins.length === 0 && (await q.getJob(lineUpKey(1))).data.fresh === true && again.data.fresh === true, 'after removal the same id is a fresh job');
    await q.remove(lineUpKey(1));
    const next = q.pickUp();
    ok(next.id === b.id, `the older waiting job goes first; the promoted due run goes behind it: ${next.id}`);
    ok(q.state(sid) === 'waiting', 'the due run was promoted to wait');
    q.pause();
    ok((await q.getJobs(['waiting'])).some((j) => j.id === sid), "'waiting' includes paused, as BullMQ does");
    ok((await q.getJobs(['paused'])).some((j) => j.id === sid), 'paused');
    q.resume();
    const p = await q.add(TASK, {}, { ...lineUpOpts(lineUpKey(3)), priority: 2 });
    ok(q.state(p.id) === 'prioritized' && (await q.getJobs(['prioritized'])).length === 1, 'prioritized');
    ok((await q.getJobs(['nonsense'])).length === 0, 'unknown types give nothing');
    const all = await q.getJobs(['active', 'active', 'waiting']);
    ok(new Set(all.map((j) => j.id)).size === all.length, 'ids are deduped');
  });

  check('a stall moves the active job to the front of wait; it runs once more with the same id and data, then fails on a second stall', async () => {
    const q = makeFakeQueue();
    await q.add(TASK, lineUpData(), lineUpOpts(LEGACY_ID));
    const a = q.pickUp();
    await q.add(TASK, {}, lineUpOpts(lineUpKey(2)));
    q.stall(a.id);
    ok(q.state(a.id) === 'waiting' && q.ids('wait')[0] === a.id, `stalled to the front of wait: ${brief(q.dump())}`);
    const again = q.pickUp();
    ok(again.id === a.id && again.timestamp === a.timestamp && again.stalledCounter === 1 && again.data.timeoutMs === TIMEOUT_MS, 'the re-run keeps id, timestamp and data');
    ok(jobKeyOf(again) === `${LEGACY_ID}@${a.timestamp}` && jobIdOfKey(jobKeyOf(again)) === LEGACY_ID, 'the legacy key form');
    q.stall(a.id);
    const third = q.pickUp();
    ok(third.deferredFailure && !q.has(a.id), 'past maxStalledCount it fails at pickup (removeOnFail deletes it)');
  });

  check('faults: a read that rejects, a read with a vanished job, and a hung add that lands when released', async () => {
    const q = makeFakeQueue();
    q.inject('getActive', { error: 'ECONNRESET' });
    await throwsWith(() => q.getActive(), /ECONNRESET/, 'injected getActive');
    q.inject('getDelayed', { undefinedEntries: 1 });
    ok((await q.getDelayed()).includes(undefined), 'an undefined entry');
    q.inject('add', { hang: true });
    let settled = false;
    const p = q.add(TASK, {}, lineUpOpts(lineUpKey(9))).then(() => { settled = true; });
    await settle();
    ok(!settled && !q.has(lineUpKey(9)), 'the hung add has not landed');
    ok(q.releaseHangs() === 1, 'one hang released');
    await p;
    ok(q.has(lineUpKey(9)), 'it landed (R1)');
  });

  check('work(): pickUp now, then complete or fail by the function', async () => {
    const q = makeFakeQueue();
    await q.add(TASK, {}, lineUpOpts(lineUpKey(1)));
    await q.add(TASK, {}, lineUpOpts(lineUpKey(2)));
    const w1 = q.work(async () => ({ skipped: true }));
    ok(w1 && q.state(w1.job.id) === 'active', 'active at once');
    ok((await w1.done).outcome === 'completed' && !q.has(w1.job.id), 'completed and removed');
    const w2 = q.work(async () => { throw new Error('boom'); });
    ok((await w2.done).outcome === 'failed' && !q.has(w2.job.id), 'failed and removed');
  });

  check('fake Redis under the real semaphore: a lease held by another task blocks, the wait gives up, a free slot is won and released', async () => {
    await withStructuredLoggingOff(async () => {
      const redis = makeFakeRedis();
      const sem = makeSemaphore(redis, { acquireTimeoutMs: 60, pollIntervalMs: 5 });
      ok(redis.calls.some((c) => c.method === 'defineCommand' && c.args[0] === 'semaphoreAcquire'), 'defineCommand was called');
      redis.holdLease({ leaseId: 'another-task', ttlMs: 600000 });
      const e = await throwsWith(() => sem.acquire('neo4j-heavy', { taskName: TASK, jobId: lineUpKey(1) }), /RESOURCE_CLASS_WAIT_TIMEOUT/, 'held lease');
      ok(e.code === WAIT_TIMEOUT_CODE, 'the give-up code');
      ok(redis.calls.filter((c) => c.method === 'semaphoreAcquire').length > 2, 'it polled');
      redis.releaseLease({ leaseId: 'another-task' });
      const release = await sem.acquire('neo4j-heavy', { taskName: TASK, jobId: lineUpKey(1) });
      const held = Object.keys(redis.leases());
      ok(typeof release === 'function' && held.length === 1, `won: ${brief(redis.leases())}`);
      await release();
      ok(Object.keys(redis.leases()).length === 0, 'released with HDEL');
      redis.holdLease({ leaseId: 'expired', expiresAt: Date.now() - 1 });
      const r2 = await sem.acquire('neo4j-heavy', {});
      ok(!Object.prototype.hasOwnProperty.call(redis.leases(), 'expired'), 'an expired lease is swept');
      await r2();
    });
  });

  check("the deps builder: the ADR's deps list, recording spies in order, kill's ESRCH, isAlive agreeing with state.isAlive", async () => {
    const world = makeWorld();
    try {
      const want = ['now', 'randomKey', 'stateDir', 'readReport', 'readConfirmation', 'isAlive', 'listClaimed', 'queueHealth', 'taskQueueEnabled', 'queue', 'kill', 'readRecord', 'writeRecord', 'renameRecord', 'ownerPubkey', 'getAdminPubkeys', 'timers'];
      ok(want.every((k) => world.deps[k] !== undefined), `every dep: ${brief(Object.keys(world.deps))}`);
      ok(['getDelayed', 'getJobs', 'getActive', 'add'].every((k) => typeof world.deps.queue[k] === 'function'), 'queue methods');
      ok(['stepMs', 'pidWaitMs', 'pidPollMs', 'endedKeysMs'].every((k) => Number.isFinite(world.deps.timers[k])), 'timers');
      const key = world.deps.randomKey();
      ok(LINEUP_ID.test(key), `randomKey is LINEUP_ID-shaped: ${key}`);
      world.deps.queueHealth();
      await world.deps.queue.add(TASK, lineUpData(), lineUpOpts(key));
      world.deps.writeRecord(recordFile({ passes: { [key]: recordEntry({ jobId: key, start: { at: iso(T0), who: whoOf('owner') } }) } }));
      ok(world.names().join(',') === 'randomKey,queueHealth,queue.add,writeRecord', `order: ${world.names()}`);
      ok(world.deps.readRecord().passes[key].start.who.key === OWNER_KEY, 'the record round-trips');
      const rec = world.startPass({ jobId: key });
      ok(world.deps.isAlive(rec) === true, 'the started pass is alive');
      const st = loadModule(MODULES.state, ['isAlive'], adr('D5'));
      ok(st.isAlive(rec, { readFile: world.procs.readFile }) === true, 'state.isAlive agrees over the fake /proc');
      world.deps.kill(rec.process.pid, 'SIGTERM');
      ok(world.kills.length === 1, 'the signal is recorded');
      world.endPass({ state: 'stopped' });
      ok(world.deps.isAlive(rec) === false && st.isAlive(rec, { readFile: world.procs.readFile }) === false, 'ended: not alive, by both');
      await throwsWith(() => world.deps.kill(rec.process.pid, 'SIGTERM'), /ESRCH/, 'kill of a dead pid');
      const latest = world.deps.readReport().latest;
      ok(latest.outcome === 'stopped' && latest.reasonCode === 'requested' && latest.job.id === key, `the stopped record: ${brief(latest)}`);
      world.record.failReads('EACCES');
      ok(world.deps.readRecord().unreadable === true && world.deps.readRecord().readError === 'EACCES', 'a read error');
      world.record.heal();
      world.record.setText('{not json');
      ok(world.deps.readRecord().damaged === true, 'a damaged file');
      const dir = world.deps.stateDir();
      ok(fs.existsSync(dir) && !dir.startsWith('/var/lib/brainstorm'), `a temp state dir: ${dir}`);
    } finally {
      world.cleanup();
    }
  });

  check('the D3 composition over a scripted semaphore and the fake processor: a gate answering skip completes without spawning', async () => {
    const world = makeWorld();
    try {
      const processor = makeFakeProcessor(world);
      const seen = [];
      const gate = {
        beforeAcquire: async (job) => { seen.push(`before:${job.id}`); return job.id === lineUpKey(1) ? 'skip' : 'go'; },
        shouldAbandon: () => false,
        afterAcquire: async (job) => { seen.push(`after:${job.id}`); return 'go'; },
        ended: (job) => { seen.push(`ended:${job.id}`); },
        gaveUp: async () => {},
        skipped: (job) => ({ skipped: true, jobId: job.id }),
      };
      const fn = adrWorkerCallback({ gate, semaphore: makeScriptedSemaphore(), processor });
      await world.queue.add(TASK, lineUpData(), lineUpOpts(lineUpKey(1)));
      await world.queue.add(TASK, lineUpData(), lineUpOpts(lineUpKey(2)));
      const w1 = world.queue.work(fn);
      ok((await w1.done).returnvalue.skipped === true && processor.calls.length === 0, 'skipped, nothing spawned');
      const w2 = world.queue.work(fn);
      await waitFor(() => processor.running(lineUpKey(2)), { what: 'the pass to start' });
      ok(world.report.latest.job.id === lineUpKey(2), 'the run carries its job id');
      processor.end(lineUpKey(2), { state: 'done' });
      ok((await w2.done).outcome === 'completed', 'completed when the run ended');
      ok(seen.join(',') === `before:${lineUpKey(1)},ended:${lineUpKey(1)},before:${lineUpKey(2)},after:${lineUpKey(2)},ended:${lineUpKey(2)}`, `order: ${seen}`);
    } finally {
      world.cleanup();
    }
  });

  check('requests: who each caller is, and a handler that answers', async () => {
    ok(passReq('owner').session.pubkey === OWNER && passReq('admin').session.pubkey === ADMIN, 'owner and admin sessions');
    ok(passReq('signed-out').session === undefined && passReq('local').localTrusted === true, 'signed out, local');
    ok(passReq('owner', { origin: 'other' }).headers.origin === ORIGINS.other, 'another site');
    ok(passReq('owner').headers['content-type'] === 'application/json' && passReq('owner', { contentType: null }).headers['content-type'] === undefined, 'content type');
    const r = await callHandler(async (req, res) => res.status(409).json({ code: 'pass-busy' }), passReq('admin'));
    ok(r.status === 409 && r.body.code === 'pass-busy' && r.rejected === null, `answered: ${brief(r.body)}`);
    const r2 = await callHandler(async (req, res) => { res.status(500).json({}); throw new Error('late'); }, passReq('admin'));
    ok(r2.rejected && r2.rejected.message === 'late', 'a rejection is reported');
  });

  const same = (a, b) => { try { require('assert').deepStrictEqual(a, b); return true; } catch (_) { return false; } };

  check("FAST_TIMERS: 150 ms steps, 2000 ms pid-wait and ended-keys windows (the pid wait under stop()'s 3000 ms call limit), and a test's own override", async () => {
    ok(same({ ...FAST_TIMERS }, { stepMs: 150, pidWaitMs: 2000, pidPollMs: 10, endedKeysMs: 2000 }), `FAST_TIMERS: ${brief(FAST_TIMERS)}`);
    ok(FAST_TIMERS.pidWaitMs < 3000, 'the pid wait gives up before a 3000 ms stop() call limit');
    const w = makeWorld();
    const w2 = makeWorld({ timers: { pidWaitMs: 300 } });
    try {
      ok(same(w.deps.timers, { ...FAST_TIMERS }), `a world's default timers: ${brief(w.deps.timers)}`);
      ok(same(w2.deps.timers, { ...FAST_TIMERS, pidWaitMs: 300 }), `an override changes only its own window: ${brief(w2.deps.timers)}`);
    } finally {
      w.cleanup();
      w2.cleanup();
    }
  });

  check("guardProcessKill: every process.kill is recorded and refused with ESRCH (signal 0 to this process included), the world's kill dep never reaches it, and restore() puts the real one back", async () => {
    const real = process.kill;
    const g = guardProcessKill();
    const world = makeWorld();
    let e1 = null;
    let e2 = null;
    let e3 = null;
    try {
      try { process.kill(4242, 'SIGTERM'); } catch (e) { e1 = e; }
      try { process.kill(process.pid, 0); } catch (e) { e2 = e; }
      try { world.deps.kill(5999, 'SIGTERM'); } catch (e) { e3 = e; }
    } finally {
      g.restore();
      world.cleanup();
    }
    ok(process.kill === real, 'restore() puts the real process.kill back');
    g.restore();
    ok(process.kill === real, 'a second restore() changes nothing');
    ok(e1 && e1.code === 'ESRCH' && e1.message === "kill ESRCH 4242 (refused by the suite's guard)", `a fake pid is refused: ${e1 && e1.message}`);
    ok(e2 && e2.code === 'ESRCH', 'signal 0 to this very process is refused too');
    ok(e3 && e3.code === 'ESRCH', "the world's kill dep answers ESRCH for a pid it does not know, by itself");
    ok(same(g.directKills, [{ pid: 4242, signal: 'SIGTERM' }, { pid: process.pid, signal: 0 }]), `directKills: ${brief(g.directKills)}`);
    const g2 = guardProcessKill({ label: 'the CT suite' });
    let msg = null;
    try { process.kill(5001); } catch (e) { msg = e.message; } finally { g2.restore(); }
    ok(msg === "kill ESRCH 5001 (refused by the CT suite's guard)", `the CT suite's own wording: ${msg}`);
    ok(same(g2.directKills, [{ pid: 5001, signal: undefined }]) && process.kill === real, 'its own list, and the real kill back');
  });

  check('recordStructuredEvents: a module loaded after it (or forgotten by it) records instead of writing, with structured logging off; the JSONL lines the Task Explorer reads; restore() puts the cache back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'te-pass-events-'));
    const modFile = path.join(dir, 'emitsOne.js');
    const realFile = path.join(REPO, STRUCTURED_EVENTS_REL);
    fs.writeFileSync(modFile, `const { emitTaskEvent } = require(${JSON.stringify(realFile)});\nmodule.exports = (...a) => emitTaskEvent(...a);\n`);
    const file = resolvedPathOf(STRUCTURED_EVENTS_REL);
    const before = require.cache[file];
    const rec = recordStructuredEvents({ forget: [modFile], now: () => T0 });
    let written = null;
    try {
      ok(rec.file === file && require.cache[file] && typeof require.cache[file].exports.emitTaskEvent === 'function', 'the stand-in sits under the real module\'s cache key');
      ok(process.env.BRAINSTORM_STRUCTURED_LOGGING === 'false', 'setup: the self-check runs with structured logging off');
      require(modFile)('TASK_START', TASK, '', { phase: 'p' });
      require(realFile).emitTaskEvent('PROGRESS', TASK, 'tgt');
      ok(same(rec.events, [{ type: 'TASK_START', taskName: TASK, target: '', meta: { phase: 'p' } }, { type: 'PROGRESS', taskName: TASK, target: 'tgt', meta: {} }]), `events: ${brief(rec.events)}`);
      ok(rec.calls.length === 2 && rec.calls.every((c) => c.fn === 'emitTaskEvent'), `calls: ${brief(rec.calls)}`);
      const l = rec.lines[0];
      ok(Object.keys(l).join(',') === 'timestamp,eventType,taskName,target,metadata,scriptName,pid', `the real module's line shape: ${brief(l)}`);
      ok(l.timestamp === iso(T0) && l.eventType === 'TASK_START' && l.pid === process.pid && l.scriptName === 'emitsOne.js', `the line's values: ${brief(l)}`);
      ok(rec.text().includes('"tgt"') && rec.jsonl().split('\n').length === 3, 'text() and jsonl() carry every call');
      written = rec.writeJsonl(dir);
      ok(written === path.join(dir, 'taskQueue', 'events.jsonl'), `writeJsonl's file: ${written}`);
      const back = fs.readFileSync(written, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
      ok(same(back, rec.lines), 'the file holds the lines, one JSON object per line');
      await throwsWith(() => rec.writeJsonl('/var/log/brainstorm'), /refuses \/var\/log\/brainstorm/, 'the live log directory');
      await throwsWith(() => rec.writeJsonl('/var/lib/brainstorm/x'), /refuses \/var\/lib\/brainstorm\/x/, 'the live state directory');
      await throwsWith(() => rec.writeJsonl('logs'), /absolute/, 'a relative directory');
    } finally {
      rec.restore();
    }
    ok(require.cache[file] === before, 'restore() puts the earlier cache entry back');
    ok(!require.cache[resolvedPathOf(modFile)], 'restore() drops the copy loaded under the stand-in');
    rec.restore();
    ok(require.cache[file] === before, 'a second restore() changes nothing');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  check('captureConsole: printed text and JSON arguments, an Error as JSON, a cyclic value survives, passThrough reaches the method it replaced, restore() puts console back', async () => {
    const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    const cap = captureConsole();
    try {
      console.log('stop asked by %s', 'someone', { who: { kind: 'local' } });
      console.warn(Object.assign(new Error('boom'), { code: 'EIO' }));
      console.error('plain');
      const cyc = {};
      cyc.self = cyc;
      console.info(cyc);
    } finally {
      cap.restore();
    }
    ok(Object.keys(saved).every((m) => console[m] === saved[m]), 'restore() puts every method back');
    cap.restore();
    ok(cap.lines.map((l) => l.level).join(',') === 'log,warn,error,info', `levels: ${brief(cap.lines.map((l) => l.level))}`);
    const t = cap.text();
    ok(t.includes('stop asked by someone') && t.includes("kind: 'local'") && t.includes('"kind":"local"'), `both renderings: ${brief(t, 400)}`);
    ok(t.includes('boom') && t.includes('"code":"EIO"'), 'an Error, printed and as JSON');
    ok(cap.lines[3].json === '[object Object]', `a cyclic value falls back to String: ${cap.lines[3].json}`);
    const realDebug = console.debug;
    const seen = [];
    console.debug = function marker(...a) { seen.push(a); };
    const marker = console.debug;
    const cap2 = captureConsole({ methods: ['debug'], passThrough: true });
    try { console.debug('x', 1); } finally { cap2.restore(); }
    const back = console.debug === marker;
    console.debug = realDebug;
    ok(back && same(seen, [['x', 1]]) && cap2.lines.length === 1 && cap2.lines[0].text === 'x 1', `passThrough: ${brief({ back, seen, lines: cap2.lines })}`);
  });

  check('in a child process: the stand-in, the console capture and the kill guard work in a `node -e` child that requires this file by its path', async () => {
    const { spawnSync } = require('child_process');
    const code = [
      `const H = require(${JSON.stringify(__filename)});`,
      'const rec = H.recordStructuredEvents();',
      'const cap = H.captureConsole();',
      'const g = H.guardProcessKill();',
      `const { emitTaskEvent } = require(${JSON.stringify(path.join(REPO, STRUCTURED_EVENTS_REL))});`,
      "emitTaskEvent('TASK_END', 'reconcileTaggingEdges', '', { n: 1 });",
      "console.log('hello', { a: 1 });",
      "let killed = null; try { process.kill(4242, 'SIGTERM'); } catch (e) { killed = e.code; }",
      'cap.restore(); g.restore(); rec.restore();',
      "process.stdout.write('@@SELF@@' + JSON.stringify({ events: rec.events, lines: cap.lines, kills: g.directKills, killed }) + '\\n');",
    ].join('\n');
    const r = spawnSync(process.execPath, ['-e', code], { cwd: REPO, encoding: 'utf8', timeout: 20000, env: { ...process.env, BRAINSTORM_STRUCTURED_LOGGING: 'false' } });
    const out = String(r.stdout || '');
    const line = out.split('\n').find((x) => x.startsWith('@@SELF@@'));
    ok(line, `the child printed its result (status ${r.status}, signal ${r.signal}; stderr ${brief(r.stderr, 400)})`);
    const x = JSON.parse(line.slice('@@SELF@@'.length));
    ok(same(x.events, [{ type: 'TASK_END', taskName: TASK, target: '', meta: { n: 1 } }]), `events: ${brief(x.events)}`);
    ok(x.lines.length === 1 && x.lines[0].text === 'hello { a: 1 }', `console: ${brief(x.lines)}`);
    ok(x.killed === 'ESRCH' && same(x.kills, [{ pid: 4242, signal: 'SIGTERM' }]), `kill: ${brief({ killed: x.killed, kills: x.kills })}`);
    ok(!out.replace(line, '').includes('hello'), 'nothing captured reached stdout');
  });

  let pass = 0;
  let fail = 0;
  const failures = [];
  const restore = structuredLoggingOff();
  try {
    for (const [n, fn] of checks) {
      try { await fn(); pass += 1; console.log(`  PASS  ${n}`); } catch (e) {
        fail += 1;
        failures.push({ name: n, message: e.message });
        console.log(`  FAIL  ${n}\n        ${e.message}`);
      }
    }
  } finally {
    restore();
  }
  console.log(`taggingEdgesPassFakes self-check: ${pass} passed, ${fail} failed`);
  return { pass, fail, skipped: 0, failures };
}

module.exports = {
  // constants
  REPO, OWNER, ADMIN, STRANGER, OWNER_KEY, ADMIN_KEY, HOST, ORIGINS, TASK, LEGACY_ID, LINEUP_ID, SCHED_PREFIX,
  SEED_ENTRY_ID, TIMEOUT_MS, WAIT_TIMEOUT_CODE, T0, PATHS, MODULES, ADR, adr, ADR_TIMERS, FAST_TIMERS, PHASES,
  // loading
  loadModule, forgetModules,
  // ids
  lineUpKey, scheduledJobId, millisOf, jobKeyOf, jobIdOfKey, lineUpData, lineUpOpts, bullmqRejects, everyNextMillis,
  // queue, Redis, semaphores
  makeFakeQueue, makeFakeRedis, holdersKey, makeSemaphore, makeScriptedSemaphore, structuredLoggingOff,
  withStructuredLoggingOff,
  // what is logged, and what is signalled
  guardProcessKill, recordStructuredEvents, captureConsole,
  // builders
  runIdAt, passRecord, reportOf, confirmationRecord, nonceOf, claimedName, statLine, procStat, makeReadFile, makeProcs,
  makeTempStateDir, makeClock, whoOf, recordEntry, historyLine, recordFile, makeRecordStore, makeWorld,
  adrWorkerCallback, makeFakeProcessor,
  // requests
  fakeReq, passReq, fakeRes, callHandler,
  // utilities
  sleep, settle, waitFor, clone, iso, brief, firstLine, errorWithCode,
  // the self-check
  selfCheck,
};

if (require.main === module) {
  selfCheck().then(({ fail }) => { process.exitCode = fail === 0 ? 0 : 1; }).catch((e) => { console.error(e); process.exitCode = 1; });
}
