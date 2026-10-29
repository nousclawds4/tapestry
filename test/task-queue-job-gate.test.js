'use strict';
/**
 * Tests for Story 6 (epic tagging-edges): the job gate in the task queue, the semaphore's abandon hook and queueHealth.
 *
 * Story: engineering-team/stories/tagging-edges/6-pass-run-and-stop.md: AC-1 ("Just after a pass ends", "When the
 *        task queue is unavailable"), AC-2 ("A waiting pass that gives up"), AC-3 ("Confirming a stop of a waiting
 *        pass: the pass never begins running", "The schedule ... the next one comes at its usual time"), AC-5 (the
 *        schedule and "started another way" as who; "a start that cannot be refused goes ahead, and shows as not
 *        recorded"), and the Test tasks "Server cases for AC-3" and "Server cases for AC-5".
 * ADR:   engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md: D1 (one controller instance, its chain
 *        and its in-memory state), D2 (queueHealth; the job key), D3 (jobGates.gateFor, the worker callback, the
 *        gate's beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp and skipped), D4 (the semaphore's abandon
 *        hook), D5 (how the gate's phases show in the busy snapshot), D9 (a Stop's marks, which the gate reads), D11
 *        (the record the gate writes), R1, R2, R3, R7, § Constraints ("Shared queue code changes only by opt-in") and
 *        § Seams for Test Design (the deps, the fake semaphore, the load-time pins).
 *
 * Intentionally failing until the implementation lands (red phase). src/manage/taskQueue/queue/jobGates.js and
 * src/pipeline/tagging-edges/control/ do not exist yet, queue/index.js exports no queueHealth() and its worker
 * callback consults no gate, and resourceSemaphore.acquire ignores context.shouldAbandon. Every module under test is
 * required lazily inside a test through test/helpers/taggingEdgesPassFakes.js's loadModule, which names what is
 * missing and the ADR decision, so this suite always loads and each test fails on the behaviour it pins.
 *
 * Classes (all JG):
 *   JG0        the shared fakes' own selfCheck() (test/helpers/taggingEdgesPassFakes.js), so CI sees a broken fake: the
 *              BullMQ facts of probes P1, P2, P5, Q2 and Q3 that every JG, CT, PX and RT test rests on (§ Seams "Fakes").
 *              It passes before and after: a check of the fakes, not of the feature.
 *   JG1–JG2    jobGates.gateFor (D3): the default controller's gate for the pass, null for every other task, the
 *              controller required only when gateFor is called, and nothing written at load.
 *   JG3–JG4    queueHealth() (D2): 'off' with no _state, 'ready' / 'not-ready' from the connection's status, and no
 *              Redis command.
 *   JG5–JG8    resourceSemaphore.acquire's shouldAbandon (D4): before an attempt, while waiting, after a win, and
 *              unchanged without it (JG8 pins today's behaviour).
 *   JG9–JG13   the worker callback initTaskQueue builds (D3), driven through the real initTaskQueue with BullMQ,
 *              ioredis, the processor, the semaphore and jobGates replaced in require's cache: the go path, every
 *              skip path, the give-up, ended always called, and other tasks unchanged (JG13 pins today's behaviour).
 *   JG14–JG25  the controller's gate (createController(deps).gate, D1 and D3) over the shared fakes: the six methods,
 *              the skip marks, the schedule's and "another way"'s starts, the phases, the waiting→running boundary,
 *              the chain, ended and gaveUp.
 *   JG26       the ADR's own worker callback (the helper's adrWorkerCallback) over the controller's gate: a Stop
 *              before pickup and while the pass waits for the lock, a pass that runs, and a give-up.
 *
 * Hermetic. TAGGING_EDGES_STATE_DIR points at a temporary directory for the whole run (restored after), and every
 * controller's record is the helper's in-memory store, so /var/lib/brainstorm is never read or written.
 * BRAINSTORM_STRUCTURED_LOGGING is false for the whole run, and the semaphore's emitTaskEvent is replaced by a
 * recorder where events are checked. No Redis, network, graph or host /proc: the queue is the helper's BullMQ-faithful
 * fake, Redis the helper's fake (for the real semaphore) or a recording connection (for queue/index.js), and liveness
 * the helper's process table. Every require.cache entry a test replaces or forgets is put back as it was afterwards.
 * process.kill is replaced for the whole run by the helper's guardProcessKill: every call is refused with ESRCH, so no
 * fake pid (4242, 5001 and up) can ever signal a real process, and a test whose run reached it fails (a signal goes only
 * through the injected kill(pid, signal) dep, D9).
 *
 * Choices this suite makes where the ADR leaves a detail open (also listed in the Test Design return):
 *   - The worker callback is exercised without a new seam: initTaskQueue runs for real over stand-ins installed in
 *     require's cache for bullmq, ioredis, ./processor, ./resourceSemaphore and ./jobGates (the cache-swap pattern of
 *     test/tagging-edges-wiring.test.js). The stand-in Worker captures the callback; the test calls it with a job.
 *   - snapshot() is called as ctl.snapshot({ ...deps, fresh }, { fresh }), which suits both snapshot(d, { fresh })
 *     (D5's wording) and snapshot({ fresh }) on an instance. Its answer's busy list is read from `items` (D5: "Busy
 *     means items.length > 0"), or `busy` if that is what it carries. Times are compared as instants, ms or ISO.
 *   - lineUp's and stop()'s return shapes are not pinned here (the routes' suites pin the answers). Where a test needs
 *     to know what a Stop did, it looks for D9's codes ('taken-out-of-line', 'asked-to-stop', 'prompt-out-of-date')
 *     anywhere in what stop() returned. Keys made by lineUp are read from the injected randomKey's record.
 *   - randomKey() returns the whole job id (LINEUP_ID-shaped, 'reconcileTaggingEdges-' + 12 hex), not its hex: lineUp
 *     adds with jobId = randomKey() as it is (§ Seams lists randomKey without its answer; D2 writes the id as
 *     'reconcileTaggingEdges-' + randomBytes(6).toString('hex')). The world's randomKey answers H.lineUpKey(n).
 *   - who is passed to lineUp and stop() in the record's shape, { kind, key: <8 hex> } (D11; the helper's whoOf).
 *   - gaveUp's lastGaveUp is served only through the status route (D12), so it is not checked here; the record's
 *     gaveUpAt is.
 *
 * Hand-rolled in the project's existing test style, no new framework.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const H = require('./helpers/taggingEdgesPassFakes');

const REPO = path.resolve(__dirname, '..');
const { TASK, LEGACY_ID, MODULES, adr, T0 } = H;
const abs = (rel) => path.join(REPO, rel);
const QUEUE_DIR = path.dirname(abs(MODULES.queue));
const STRUCTURED_EVENTS = abs('src/utils/structuredEvents.js');
const REGISTRY = abs('src/manage/taskQueue/taskRegistry.json');
const WAIT_CODE = 'RESOURCE_CLASS_WAIT_TIMEOUT';
const HEAVY = 'neo4j-heavy';
const GATE_METHODS = ['beforeAcquire', 'shouldAbandon', 'afterAcquire', 'ended', 'gaveUp', 'skipped'];
/** queue/index.js's exports at 48de58a7; D2: "The existing exports stay." */
const QUEUE_EXPORTS = ['initTaskQueue', 'closeTaskQueue', 'isQueueAvailable', 'enqueueTask', 'runViaQueueSync', 'runViaQueueAsync', 'getQueue', 'getAllQueues', 'computeJobId'];
/** D4: "The abandoned event carries the same fields as the others" (resourceSemaphore.js's wait_end events). */
const EVENT_FIELDS = ['phase', 'resourceClass', 'wait_seconds', 'outcome', 'jobId'];
const OWNER_WHO = H.whoOf('owner');
const ADMIN_WHO = H.whoOf('admin');
const MIN = 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// ─── test harness ──────────────────────────────────────────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}
function show(v) {
  if (v === undefined) return 'undefined';
  if (typeof v === 'function') return '<a function>';
  if (v instanceof Error) return `<${v.code || 'Error'}: ${firstLine(v)}>`;
  try {
    return JSON.stringify(sortKeys(v), (k, x) => (typeof x === 'string' && x.length > 160 ? `${x.slice(0, 60)}…(${x.length} characters)` : x));
  } catch (_) {
    return String(v);
  }
}
const exact = (v) => JSON.stringify(sortKeys(v));
function same(actual, expected, label) {
  if (exact(actual) !== exact(expected)) throw new Error(`${label}\n        expected: ${show(expected)}\n        actual:   ${show(actual)}`);
}
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
const isThenable = (v) => !!v && (typeof v === 'object' || typeof v === 'function') && typeof v.then === 'function';
const toMs = (v) => (typeof v === 'number' ? v : (typeof v === 'string' ? Date.parse(v) : NaN));
const textOf = (v) => { try { return JSON.stringify(v) || String(v); } catch (_) { return String(v); } };
/** Run several cases; report every failing one, not only the first. */
async function cases(list, fn) {
  const failed = [];
  for (const c of list) {
    try { await fn(c); } catch (e) { failed.push(`[${c.name}] ${e.message}`); }
  }
  assert(failed.length === 0, `${failed.length} of ${list.length} case(s) failed:\n        ${failed.join('\n        ')}`);
}
function report(problems) { assert(problems.length === 0, problems.join('\n        ')); }
/** Settle `p` within `ms`, or throw naming `what`. */
async function within(p, ms, what) {
  let timer;
  const r = await Promise.race([
    Promise.resolve(p).then((v) => ({ v }), (e) => ({ e })),
    new Promise((res) => { timer = setTimeout(() => res({ timeout: true }), ms); }),
  ]);
  clearTimeout(timer);
  if (r.timeout) throw new Error(`${what} did not settle within ${ms} ms`);
  if (r.e) throw r.e;
  return r.v;
}
/** A promise and whether it has settled yet. */
function track(p) {
  const t = { settled: false, value: undefined, error: undefined };
  t.promise = Promise.resolve(p).then((v) => { t.settled = true; t.value = v; return v; }, (e) => { t.settled = true; t.error = e; return undefined; });
  return t;
}
async function quiet(fn) {
  const saved = { log: console.log, warn: console.warn, info: console.info };
  console.log = () => {}; console.warn = () => {}; console.info = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

// ─── require's cache: stand-ins, put back afterwards ───────────────────────────────────────────────────────────
function cacheEntry(file, exportsValue) {
  const m = new Module(file, null);
  m.filename = file;
  m.loaded = true;
  m.exports = exportsValue;
  try { m.paths = Module._nodeModulePaths(path.dirname(file)); } catch (_) { /* not needed */ }
  return m;
}
/** Install `stubs` ({ absPath: exports }) and forget `forget` (abs paths), run fn, then put every entry back. */
async function withCache({ stubs = {}, forget = [] }, fn) {
  const touched = [...new Set([...Object.keys(stubs), ...forget])];
  const saved = new Map(touched.map((p) => [p, require.cache[p]]));
  for (const p of forget) delete require.cache[p];
  for (const [p, ex] of Object.entries(stubs)) require.cache[p] = cacheEntry(p, ex);
  try {
    return await fn();
  } finally {
    for (const p of touched) {
      if (saved.get(p)) require.cache[p] = saved.get(p); else delete require.cache[p];
    }
  }
}
const CONTROL_MODULES = [MODULES.controller, MODULES.gate, MODULES.store, MODULES.jobGates].map(abs);
const inCache = (rel) => !!require.cache[abs(rel)];

// ─── the registry ──────────────────────────────────────────────────────────────────────────────────────────────
function realTasks() { return JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).tasks || {}; }
/** The pass, one other tagged task, and one untagged task, with their real definitions. */
function miniRegistry() {
  const all = realTasks();
  const otherTagged = Object.keys(all).find((n) => n !== TASK && all[n] && all[n].resourceClass);
  const untagged = Object.keys(all).find((n) => all[n] && !all[n].resourceClass);
  assert(all[TASK] && all[TASK].resourceClass === HEAVY, `setup: taskRegistry.json's ${TASK} should carry resourceClass "${HEAVY}"`);
  assert(otherTagged && untagged, 'setup: the registry should hold another tagged task and an untagged one');
  return { registry: { tasks: { [TASK]: all[TASK], [otherTagged]: all[otherTagged], [untagged]: all[untagged] } }, otherTagged, untagged };
}

// ─── queue/index.js over stand-ins ─────────────────────────────────────────────────────────────────────────────
/** A recording Redis connection: any method call is recorded (ping never settles: a Redis that hangs). */
function makeConnection(status) {
  const calls = [];
  const target = { status };
  const conn = new Proxy(target, {
    get(t, prop) {
      if (prop === 'status') return t.status;
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'constructor' || prop === 'toJSON') return undefined;
      return (...args) => {
        calls.push({ method: String(prop), args: args.length });
        return prop === 'ping' ? new Promise(() => {}) : Promise.resolve('OK');
      };
    },
  });
  return { conn, calls, setStatus(s) { target.status = s; } };
}
function bullStandIns(fakes) {
  class Queue { constructor(name, opts) { this.name = name; this.opts = opts; fakes.queues.set(name, this); } async close() {} }
  class Worker {
    constructor(name, fn, opts) { this.name = name; this.fn = fn; this.opts = opts; fakes.workers.set(name, this); }
    on() { return this; }
    async close() {}
  }
  class QueueEvents { constructor(name) { this.name = name; } async close() {} }
  return { Queue, Worker, QueueEvents };
}
/**
 * Load queue/index.js fresh over stand-ins for bullmq, ioredis, ./processor, ./resourceSemaphore and ./jobGates.
 * o: { gateFor(taskName), semaphore, processor, status, wanted, adrRef }.
 */
async function withQueueModule(o, fn) {
  const fakes = { queues: new Map(), workers: new Map(), connections: [], gateForCalls: [], createSemaphoreCalls: [] };
  function Redis(opts) { const c = makeConnection(o.status || 'ready'); c.opts = opts; fakes.connections.push(c); return c.conn; }
  const stubs = {
    [require.resolve('bullmq', { paths: [QUEUE_DIR] })]: bullStandIns(fakes),
    [require.resolve('ioredis', { paths: [QUEUE_DIR] })]: Redis,
    [abs(MODULES.processor)]: { processJob: (...a) => (o.processor ? o.processor.processJob(...a) : Promise.resolve({ success: true })) },
    [abs(MODULES.semaphore)]: {
      createSemaphore: (redis, caps, opts) => {
        fakes.createSemaphoreCalls.push({ caps, opts });
        return o.semaphore || { acquire: async () => async () => {} };
      },
    },
    [abs(MODULES.jobGates)]: {
      gateFor: (taskName) => { fakes.gateForCalls.push(taskName); return o.gateFor ? o.gateFor(taskName) : null; },
    },
  };
  return withCache({ stubs, forget: [abs(MODULES.queue)] }, async () => {
    const mod = H.loadModule(MODULES.queue, o.wanted || { initTaskQueue: 'function', closeTaskQueue: 'function' }, o.adrRef || adr('D3'));
    try {
      return await fn(mod, fakes);
    } finally {
      try { await quiet(() => mod.closeTaskQueue()); } catch (_) { /* best effort */ }
    }
  });
}
const initWith = (mod, registry) => quiet(() => mod.initTaskQueue({ registry }));

/** A gate standing in for the controller's, recording into `log`. Its answers are read from `opts` at call time. */
function workerGate(log, opts = {}) {
  const calls = [];
  const rec = (name, job, extra) => { calls.push({ name, jobId: job && job.id, job, extra }); log.push(name); };
  const answer = (v, job) => (typeof v === 'function' ? v(job) : v);
  return {
    opts,
    calls,
    async beforeAcquire(job) { rec('beforeAcquire', job); if (opts.beforeThrows) throw opts.beforeThrows; return answer(opts.before === undefined ? 'go' : opts.before, job); },
    shouldAbandon(job) { rec('shouldAbandon', job); return !!answer(opts.abandon || false, job); },
    async afterAcquire(job) { rec('afterAcquire', job); if (opts.afterThrows) throw opts.afterThrows; return answer(opts.after === undefined ? 'go' : opts.after, job); },
    ended(job) { rec('ended', job); },
    async gaveUp(job, err) { rec('gaveUp', job, err); await H.sleep(opts.gaveUpMs || 0); log.push('gaveUp-settled'); },
    skipped(job) { rec('skipped', job); return { skipped: true, jobId: job && job.id, from: 'the gate under test' }; },
  };
}
/** A semaphore for the worker tests. mode: 'win' | 'consult' (D4's contract: ask shouldAbandon, then win) | 'null' | 'timeout' | 'error'. */
function workerSemaphore(log, mode = 'win') {
  const sem = {
    mode,
    calls: [],
    releases: 0,
    async acquire(cls, ctx) {
      const c = { cls, ctx: ctx || {}, keys: Object.keys(ctx || {}).sort() };
      sem.calls.push(c);
      log.push('acquire');
      let m = sem.mode;
      if (m === 'consult') {
        c.abandonAnswer = !!(ctx && typeof ctx.shouldAbandon === 'function' && ctx.shouldAbandon());
        m = c.abandonAnswer ? 'null' : 'win';
      }
      if (m === 'null') return null;
      if (m === 'timeout') throw Object.assign(new Error(`Could not acquire resource class "${cls}" (test). ${WAIT_CODE}.`), { code: WAIT_CODE });
      if (m === 'error') throw Object.assign(new Error('the semaphore failed (test)'), { code: 'ECONNRESET' });
      return async () => { log.push('release'); sem.releases += 1; };
    },
  };
  return sem;
}
function workerProcessor(log, opts = {}) {
  const p = {
    calls: [],
    async processJob(job, def) {
      p.calls.push({ job, def });
      log.push('processJob');
      if (opts.throws) throw opts.throws;
      return opts.result === undefined ? { success: true, exitCode: 0, from: 'the processor under test' } : opts.result;
    },
  };
  return p;
}
async function runCallback(fn, job, log) {
  return within(
    Promise.resolve().then(() => fn(job)).then((value) => { log.push('resolved'); return { value }; }, (error) => { log.push('rejected'); return { error }; }),
    3000,
    'the worker callback',
  );
}
const passJob = (n = 1) => ({ id: H.lineUpKey(n), name: TASK, timestamp: T0, data: H.lineUpData() });
/** initTaskQueue over stand-ins, with a recording gate for the pass. */
async function withGatedWorker(o, fn) {
  const log = [];
  const gate = workerGate(log, o.gate || {});
  const sem = workerSemaphore(log, o.sem || 'win');
  const processor = workerProcessor(log, o.processor || {});
  const reg = miniRegistry();
  return withQueueModule({ gateFor: (t) => (t === TASK ? gate : null), semaphore: sem, processor }, async (mod, fakes) => {
    await initWith(mod, reg.registry);
    const w = fakes.workers.get(TASK);
    assert(w && typeof w.fn === 'function', `setup: initTaskQueue should build a Worker for ${TASK}; it built ${show([...fakes.workers.keys()])}`);
    return fn({ log, gate, sem, processor, fakes, reg, callback: w.fn, workerOf: (n) => fakes.workers.get(n) });
  });
}
const NO_GATE_SEEN = (log) => `(the gate was never consulted: the callback called ${show(log)}; ${adr('D3')}: "With a gate, the resourceClass branch is: …")`;

// ─── the real semaphore over the fake Redis ────────────────────────────────────────────────────────────────────
async function withRealSemaphore(o, fn) {
  const events = [];
  const stubs = { [STRUCTURED_EVENTS]: { emitTaskEvent: (type, taskName, target, meta) => { events.push({ type, taskName, target, meta: meta || {} }); } } };
  return withCache({ stubs, forget: [abs(MODULES.semaphore)] }, async () => {
    const mod = H.loadModule(MODULES.semaphore, { createSemaphore: 'function' }, adr('D4'));
    const redis = H.makeFakeRedis();
    const sem = mod.createSemaphore(redis, { [HEAVY]: 1 }, { pollIntervalMs: 5, acquireTimeoutMs: o.acquireTimeoutMs || 150 });
    const attempts = () => redis.calls.filter((c) => c.method === 'semaphoreAcquire');
    const ends = (outcome) => events.filter((e) => e.meta.phase === 'resource_class_wait_end' && (outcome === undefined || e.meta.outcome === outcome));
    const phaseIndex = (phase, outcome) => events.findIndex((e) => e.meta.phase === phase && (outcome === undefined || e.meta.outcome === outcome));
    return fn({ sem, redis, events, attempts, ends, phaseIndex });
  });
}
const semCtx = (o = {}) => ({ taskName: TASK, target: '', jobId: H.lineUpKey(5), ...o });
/** Release whatever a still-pending or wrongly-won acquire holds, so nothing leaks past the test. */
async function drain(t, redis) {
  if (!t.settled) { redis.releaseLease(); await within(t.promise, 1000, 'the leftover acquire').catch(() => {}); }
  if (typeof t.value === 'function') { try { await t.value(); } catch (_) { /* best effort */ } }
}

// ─── the controller over the shared world ──────────────────────────────────────────────────────────────────────
const loadController = () => H.loadModule(MODULES.controller, { createController: 'function' }, adr('D1'));
function newController(world) {
  const { createController } = loadController();
  const ctl = createController(world.deps);
  const missing = ['lineUp', 'stop', 'snapshot'].filter((n) => !ctl || typeof ctl[n] !== 'function');
  const gateMissing = GATE_METHODS.filter((n) => !ctl || !ctl.gate || typeof ctl.gate[n] !== 'function');
  assert(!missing.length && !gateMissing.length,
    `createController(deps) should return { lineUp, stop, snapshot, gate: { ${GATE_METHODS.join(', ')} } } (${adr('D1')} "One instance"); missing: ${show([...missing, ...gateMissing.map((n) => `gate.${n}`)])}`);
  return ctl;
}
async function withWorld(o, fn) {
  const world = H.makeWorld(o || {});
  try { return await fn(world); } finally { world.cleanup(); }
}
async function snap(ctl, world, fresh = true) {
  return within(Promise.resolve(ctl.snapshot({ ...world.deps, fresh }, { fresh })), 3000, 'snapshot()');
}
async function itemsNow(ctl, world, fresh = true) {
  const s = await snap(ctl, world, fresh);
  const list = s && (Array.isArray(s.items) ? s.items : (Array.isArray(s.busy) ? s.busy : null));
  assert(list, `snapshot() should answer { queue, items, … } (${adr('D5')}: "Busy means items.length > 0"); it answered ${show(s)}`);
  return list;
}
const itemFor = (list, key) => list.find((i) => i && i.key === key);
async function addJob(world, id) {
  return world.queue.add(TASK, H.lineUpData(), id === undefined ? { removeOnComplete: true, removeOnFail: true } : H.lineUpOpts(id));
}
function pickUp(world, wantId, label) {
  const job = world.queue.pickUp();
  assert(job && (wantId === undefined || job.id === wantId), `setup (${label}): the fake queue should pick up ${show(wantId)}; it picked ${show(job && job.id)}`);
  return job;
}
const gateCall = (p, what) => within(Promise.resolve(p), 3000, what);
async function must(p, want, what) {
  const got = await gateCall(p, what);
  assert(got === want, `setup: ${what} should answer ${show(want)}; it answered ${show(got)}`);
  return got;
}
async function stopNow(ctl, targets, who = ADMIN_WHO) {
  return within(Promise.resolve(ctl.stop({ who, targets })), 3000, 'stop()');
}
function stopDid(r, code, label) {
  assert(textOf(r).includes(`"${code}"`), `setup (${label}): the Stop should answer ${code} (${adr('D9')}); stop() answered ${show(r)}`);
}
/** A job for `key` picked up and launched through the gate, with its pass running (report.latest alive, job.id = key). */
async function runningPass(world, ctl, key) {
  await addJob(world, key);
  const job = pickUp(world, key, 'a running pass');
  await must(ctl.gate.beforeAcquire(job), 'go', `beforeAcquire(${key})`);
  await must(ctl.gate.afterAcquire(job), 'go', `afterAcquire(${key})`);
  world.startPass({ jobId: key });
  return job;
}
async function stopRunning(world, ctl, key) {
  const r = await stopNow(ctl, [{ key, state: 'running' }]);
  assert(world.kills.some((k) => k.signal === 'SIGTERM'), `setup: the Stop of the running pass ${key} should send its pid SIGTERM (${adr('D9')} step 4); stop() answered ${show(r)}, kills ${show(world.kills)}`);
  return r;
}
/** The record with the owner's start for `key` (a Run, D6) and its history line. */
function ownerStartRecord(key, atMs = T0 - 10 * MIN) {
  const at = iso(atMs);
  return H.recordFile({
    passes: { [key]: H.recordEntry({ jobId: key, start: { at, who: OWNER_WHO } }) },
    history: [H.historyLine('start', key, at, OWNER_WHO)],
  });
}
const parsed = (world) => world.record.parsed() || { passes: {}, history: [] };
const startLines = (rec, key) => ((rec && rec.history) || []).filter((l) => l && l.action === 'start' && l.key === key);
const queueCalls = (world) => world.calls.filter((c) => c.name.startsWith('queue.')).length;

// ═══ JG0: the shared fakes' own self-check ═════════════════════════════════════════════════════════════════════

test('JG0: the shared fakes every JG, CT, PX and RT test is built on still agree with the facts they stand for — test/helpers/taggingEdgesPassFakes.js\'s selfCheck() answers no failure: BullMQ\'s own id rule, checked against BullMQ itself (P1); a re-add of an existing id that joins (P2); remove\'s answers for an active job and a scheduler\'s current job (P5, Q2); the scheduler\'s next iteration at pickup, at its usual slot (Q3); a stall back to the front of wait; waiting order, promotion and getJobs\' type names; the fake Redis under the real semaphore; the deps builder; the D3 composition; and the test timers, kill guard and log recorders [ADR tagging-edges/0006 § Seams for Test Design "A BullMQ-faithful fake queue, a subset pinned by this ADR\'s probes"; "Its id rule is checked against BullMQ itself … Ledger 2026-10-14-fakes-hide-library-validation asks this of any faked library call"; "The Tester re-derives the probe from § Context\'s P1, P2, P5, Q2 and Q3"] (passes before and after: a check of the shared fakes, not of the feature)', async () => {
  assert(typeof H.selfCheck === 'function', 'setup: test/helpers/taggingEdgesPassFakes.js should export selfCheck()');
  // selfCheck prints a PASS/FAIL line per check; quiet() keeps them out of this suite's own lines, and its failures
  // come back in r.failures.
  const r = await quiet(() => H.withStructuredLoggingOff(() => H.selfCheck()));
  assert(r && Number.isInteger(r.pass) && Number.isInteger(r.fail), `selfCheck() should answer { pass, fail, failures }; it answered ${show(r)}`);
  assert(r.fail === 0, `the shared fakes no longer match the facts the suites rest on (§ Seams "Fakes"): ${r.fail} of ${r.pass + r.fail} self-check(s) failed:\n        ${(r.failures || []).map((f) => `[${f.name}] ${firstLine(f.message)}`).join('\n        ')}`);
  assert(r.pass > 0, `selfCheck() ran no check at all (${show(r)}); a self-check that checks nothing proves nothing`);
});

// ═══ JG1–JG2: jobGates.gateFor (D3) ═══════════════════════════════════════════════════════════════════════════

test('JG1: jobGates.gateFor("reconcileTaggingEdges") is the default controller\'s gate, controller.gate itself, the same object on every call, with beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp and skipped; every other registry task, and every name that only resembles the pass\'s, gets null [ADR tagging-edges/0006 D3 "The opt-in"; D1 "The default instance … jobGates.gateFor … use it, so the routes and the worker share one state"; § Out of scope "jobGates.js serves this one task"]', async () => {
  await withCache({ forget: CONTROL_MODULES }, async () => {
    const jg = H.loadModule(MODULES.jobGates, { gateFor: 'function' }, adr('D3'));
    const gate = jg.gateFor(TASK);
    const ctlMod = H.loadModule(MODULES.controller, { controller: 'object', createController: 'function' }, adr('D1'));
    const p = [];
    if (!gate || typeof gate !== 'object') p.push(`gateFor("${TASK}") should be the controller's gate object; it is ${show(gate)}`);
    else {
      if (gate !== ctlMod.controller.gate) p.push(`gateFor("${TASK}") should be require('…/control').controller.gate itself, so the routes and the worker share one state (${adr('D1')}); it is another object`);
      const missing = GATE_METHODS.filter((n) => typeof gate[n] !== 'function');
      if (missing.length) p.push(`the gate lacks ${show(missing)} (${adr('D1')}: gate: { ${GATE_METHODS.join(', ')} })`);
      if (jg.gateFor(TASK) !== gate) p.push('a second gateFor call should give the same gate');
    }
    const others = Object.keys(realTasks()).filter((n) => n !== TASK);
    assert(others.length > 20, 'setup: the registry lists the other tasks');
    const lookalikes = [`${TASK}-a00000000001`, `${TASK} `, 'ReconcileTaggingEdges', 'reconcileTaggingEdge', 'repeat:sched:seed:reconcileTaggingEdges', ''];
    const notNull = [...others, ...lookalikes].filter((n) => jg.gateFor(n) !== null);
    if (notNull.length) p.push(`gateFor should answer null for every task but the pass (${adr('D3')}: "null for every other task"); it did not for ${show(notNull.slice(0, 8))}`);
    report(p);
  });
});

test('JG2: loading queue/index.js and then jobGates.js requires no controller, and the controller is required only when gateFor("reconcileTaggingEdges") is called; even then nothing is written under the state directory (no control/ directory, no record) [ADR tagging-edges/0006 D3 "gateFor requires the controller only when it is called"; D1 "Requires … so queue/index.js can require the gate at init without a cycle"; § Seams "Load-time pins": "nothing loads with side effects … no <stateDir>/control/ mkdir and no record read until first use"]', async () => {
  const dir = H.makeTempStateDir('job-gate-load');
  const restoreEnv = dir.useAsEnv();
  try {
    await withCache({ forget: [...CONTROL_MODULES, abs(MODULES.queue)] }, async () => {
      const p = [];
      const q = H.loadModule(MODULES.queue, { initTaskQueue: 'function' }, adr('D3'));
      assert(q && inCache(MODULES.queue), 'setup: queue/index.js should load');
      if (inCache(MODULES.controller)) p.push(`loading queue/index.js loaded ${MODULES.controller}; the controller must be required only when gateFor is called (${adr('D3')})`);
      const jg = H.loadModule(MODULES.jobGates, { gateFor: 'function' }, adr('D3'));
      if (inCache(MODULES.controller)) p.push(`loading jobGates.js loaded ${MODULES.controller}; it must require it only inside gateFor (${adr('D3')})`);
      const gate = jg.gateFor(TASK);
      if (!inCache(MODULES.controller)) p.push(`gateFor("${TASK}") answered ${show(gate)} without loading ${MODULES.controller} (${adr('D3')}: "It returns the default controller's gate, require('../../../pipeline/tagging-edges/control').controller.gate")`);
      if (!gate || typeof gate.beforeAcquire !== 'function') p.push(`gateFor("${TASK}") should give the controller's gate; it gave ${show(gate)}`);
      const left = fs.readdirSync(dir.dir);
      if (left.length) p.push(`loading the controller wrote ${show(left)} under TAGGING_EDGES_STATE_DIR; nothing may be written at load (§ Seams "Load-time pins"; ${adr('D1')}: the record is "loaded lazily from disk on first use")`);
      report(p);
    });
  } finally {
    restoreEnv();
    dir.cleanup();
  }
});

// ═══ JG3–JG4: queueHealth() (D2) ══════════════════════════════════════════════════════════════════════════════

test('JG3: queue/index.js exports queueHealth() beside every export it had; with no _state (before initTaskQueue, and again after closeTaskQueue) it answers "off", a string returned at once, and makes no Redis connection [ADR tagging-edges/0006 D2 "A new export in queue/index.js. queueHealth() returns \'off\' when _state is null … The existing exports stay"]', async () => {
  const wanted = { queueHealth: 'function' };
  for (const n of QUEUE_EXPORTS) wanted[n] = 'function';
  await withQueueModule({ wanted, adrRef: adr('D2') }, async (mod, fakes) => {
    const p = [];
    const before = mod.queueHealth();
    if (isThenable(before)) p.push(`queueHealth() returned a promise; it issues no command and answers at once (${adr('D2')}; D1: "First check d.queueHealth() (D2), which issues no command")`);
    else if (before !== 'off') p.push(`before initTaskQueue, queueHealth() should answer "off" (${adr('D2')}); it answered ${show(before)}`);
    if (fakes.connections.length) p.push(`queueHealth() with no _state made ${fakes.connections.length} Redis connection(s)`);
    await initWith(mod, miniRegistry().registry);
    if (fakes.connections.length !== 1) p.push(`setup: initTaskQueue should make its one shared connection; it made ${fakes.connections.length}`);
    const during = mod.queueHealth();
    if (during !== 'ready') p.push(`after initTaskQueue over a ready connection, queueHealth() should answer "ready"; it answered ${show(during)}`);
    await quiet(() => mod.closeTaskQueue());
    const after = mod.queueHealth();
    if (after !== 'off') p.push(`after closeTaskQueue (_state null again), queueHealth() should answer "off"; it answered ${show(after)}`);
    report(p);
  });
});

test('JG4: after initTaskQueue, queueHealth() answers "ready" exactly when the shared connection\'s status is "ready", and "not-ready" for wait, connecting, connect, reconnecting, close and end; it issues no Redis command (no ping, nothing at all on the connection), so it answers at once while a ping would hang [ADR tagging-edges/0006 D2 "\'ready\' when _state.redis.status === \'ready\', and \'not-ready\' otherwise. It issues no Redis command"; § Context "Redis can hang a caller … isQueueAvailable() pings and can hang with it"]', async () => {
  await withQueueModule({ wanted: { queueHealth: 'function', initTaskQueue: 'function', closeTaskQueue: 'function' }, adrRef: adr('D2') }, async (mod, fakes) => {
    await initWith(mod, miniRegistry().registry);
    const c = fakes.connections[0];
    assert(c, 'setup: initTaskQueue should make a Redis connection');
    c.calls.length = 0;
    const p = [];
    const rows = [['ready', 'ready'], ['wait', 'not-ready'], ['connecting', 'not-ready'], ['connect', 'not-ready'], ['reconnecting', 'not-ready'], ['close', 'not-ready'], ['end', 'not-ready'], ['ready', 'ready']];
    for (const [status, want] of rows) {
      c.setStatus(status);
      const got = mod.queueHealth();
      if (isThenable(got)) { p.push(`with status ${status}, queueHealth() returned a promise; it must answer from the status at once (${adr('D2')})`); continue; }
      if (got !== want) p.push(`with the connection's status "${status}", queueHealth() should answer "${want}"; it answered ${show(got)}`);
    }
    if (c.calls.length) p.push(`queueHealth() issued Redis commands ${show(c.calls.map((x) => x.method))}; it must issue none (${adr('D2')})`);
    report(p);
  });
});

// ═══ JG5–JG8: the semaphore's abandon hook (D4) ════════════════════════════════════════════════════════════════

test('JG5: acquire with a shouldAbandon that answers true at the top of the first loop pass resolves null before any attempt — no semaphoreAcquire call, no lease, and no event at all, since wait_begin was never emitted — although the lock is free [ADR tagging-edges/0006 D4 "at the top of each loop pass, before semaphoreAcquire: if it answers true, emit resource_class_wait_end with outcome: \'abandoned\' (only if wait_begin was emitted) and return null"]', async () => {
  await H.withStructuredLoggingOff(() => withRealSemaphore({}, async ({ sem, redis, events, attempts }) => {
    let asked = 0;
    const t = track(sem.acquire(HEAVY, semCtx({ shouldAbandon: () => { asked += 1; return true; } })));
    try {
      await within(t.promise, 1000, 'acquire');
      const p = [];
      if (t.error) p.push(`acquire rejected ${show(t.error)}; it should resolve null (${adr('D4')})`);
      else if (t.value !== null) p.push(`acquire should resolve null when shouldAbandon answers true before the first attempt (${adr('D4')}); it resolved ${typeof t.value === 'function' ? 'a release function, having won the lock' : show(t.value)}`);
      if (asked < 1) p.push('shouldAbandon was never consulted');
      if (attempts().length) p.push(`acquire made ${attempts().length} semaphoreAcquire attempt(s); an abandon at the top of the loop comes before any attempt`);
      if (Object.keys(redis.leases()).length) p.push(`a lease was left: ${show(redis.leases())}`);
      if (events.length) p.push(`no event belongs to an abandon before wait_begin; it emitted ${show(events.map((e) => [e.meta.phase, e.meta.outcome]))}`);
      report(p);
    } finally {
      await drain(t, redis);
    }
  }));
});

test('JG6: while acquire waits behind another task\'s lease, a shouldAbandon that turns true ends the wait at the next loop pass — acquire resolves null, emits one resource_class_wait_end with outcome "abandoned" after its wait_begin, carrying the task name, class and job id and no other fields, makes no further attempt, and leaves the other task\'s lease alone [ADR tagging-edges/0006 D4 "at the top of each loop pass"; "Why inside the loop. Abandoning from outside, by racing the promise, would leave the loop polling"; "No who. The abandoned event carries the same fields as the others"; D9 "at its next lock poll, within 500 ms, through shouldAbandon"]', async () => {
  await H.withStructuredLoggingOff(() => withRealSemaphore({ acquireTimeoutMs: 3000 }, async ({ sem, redis, events, attempts, ends, phaseIndex }) => {
    redis.holdLease();
    let abandon = false;
    const ctx = semCtx({ shouldAbandon: () => abandon });
    const t = track(sem.acquire(HEAVY, ctx));
    try {
      await H.waitFor(() => attempts().length >= 2, { what: 'two lock attempts behind the other task' });
      assert(phaseIndex('resource_class_wait_begin') >= 0, 'setup: the waiting acquire should have emitted resource_class_wait_begin');
      abandon = true;
      const atFlip = attempts().length;
      try {
        await within(t.promise, 300, 'acquire after shouldAbandon answered true');
      } catch (e) {
        throw new Error(`${firstLine(e)}: it kept polling (${attempts().length - atFlip} more attempt(s)); ${adr('D4')} has acquire consult shouldAbandon at the top of each loop pass and return null`);
      }
      const p = [];
      if (t.error) p.push(`acquire rejected ${show(t.error)}; it should resolve null`);
      else if (t.value !== null) p.push(`acquire should resolve null; it resolved ${show(t.value)}`);
      await H.sleep(40);
      if (attempts().length !== atFlip) p.push(`acquire made ${attempts().length - atFlip} attempt(s) after shouldAbandon turned true; the loop must stop`);
      const abandoned = ends('abandoned');
      if (abandoned.length !== 1) p.push(`one wait_end with outcome "abandoned" should be emitted; there were ${abandoned.length} (${show(events.map((e) => [e.meta.phase, e.meta.outcome]))})`);
      else {
        const e = abandoned[0];
        if (phaseIndex('resource_class_wait_end', 'abandoned') < phaseIndex('resource_class_wait_begin')) p.push('the abandoned event came before wait_begin');
        if (e.taskName !== TASK) p.push(`the abandoned event should name the task ${TASK}; it named ${show(e.taskName)}`);
        if (e.meta.resourceClass !== HEAVY || e.meta.jobId !== ctx.jobId) p.push(`the abandoned event should carry the class and job id; it carried ${show(e.meta)}`);
        const extra = Object.keys(e.meta).filter((k) => !EVENT_FIELDS.includes(k));
        if (extra.length) p.push(`the abandoned event carries fields the others do not: ${show(extra)} (${adr('D4')}: "the same fields as the others: task name, class and job id")`);
      }
      if (ends('acquired').length || ends('timeout').length) p.push(`an abandoned wait is neither acquired nor timed out; events ${show(events.map((e) => [e.meta.phase, e.meta.outcome]))}`);
      same(redis.leases(), { 'another-task': redis.leases()['another-task'] }, 'only the other task\'s lease should remain');
      report(p);
    } finally {
      await drain(t, redis);
    }
  }));
});

test('JG7: a shouldAbandon that answers true just after a winning attempt makes acquire HDEL the lease it just won and resolve null, with no "acquired" event — after a wait behind another task (one "abandoned" event follows its wait_begin) and on a first attempt that wins at once [ADR tagging-edges/0006 D4 "after a winning semaphoreAcquire, before the wait_end acquired event: if it answers true, HDEL the lease just won, emit abandoned, and return null"; "would later leak a lease for 4 h"]', async () => {
  await cases([
    { name: 'after a wait behind another task', wait: true },
    { name: 'on a first attempt that wins at once', wait: false },
  ], (c) => H.withStructuredLoggingOff(() => withRealSemaphore({ acquireTimeoutMs: 3000 }, async ({ sem, redis, events, attempts, ends, phaseIndex }) => {
    if (c.wait) redis.holdLease();
    const ours = () => Object.keys(redis.leases()).filter((id) => id !== 'another-task');
    const t = track(sem.acquire(HEAVY, semCtx({ shouldAbandon: () => ours().length > 0 })));
    try {
      if (c.wait) {
        await H.waitFor(() => attempts().length >= 2, { what: 'two lock attempts behind the other task' });
        redis.releaseLease();
      }
      await within(t.promise, 1000, 'acquire');
      const p = [];
      const won = attempts()[attempts().length - 1];
      if (t.error) p.push(`acquire rejected ${show(t.error)}`);
      else if (t.value !== null) p.push(`acquire should resolve null when shouldAbandon answers true after the win (${adr('D4')}); it resolved ${typeof t.value === 'function' ? `a release function, and the lease ${show(ours())} stays held` : show(t.value)}`);
      if (ours().length) p.push(`the lease just won should be removed with HDEL; ${show(ours())} is still held`);
      const leaseId = won && won.args[1];
      const hdel = redis.calls.find((x) => x.method === 'hdel' && x.args.includes(leaseId));
      if (!hdel) p.push(`acquire should HDEL the lease it won (${show(leaseId)}); hdel calls: ${show(redis.calls.filter((x) => x.method === 'hdel').map((x) => x.args))}`);
      if (ends('acquired').length) p.push('a wait_end "acquired" was emitted for a lease handed back at once; the abandon comes before it');
      if (c.wait) {
        const a = ends('abandoned');
        if (a.length !== 1) p.push(`one "abandoned" event should follow the wait; there were ${a.length}`);
        else if (phaseIndex('resource_class_wait_end', 'abandoned') < phaseIndex('resource_class_wait_begin')) p.push('the abandoned event came before wait_begin');
      }
      report(p);
    } finally {
      await drain(t, redis);
    }
  })));
});

test('JG8: without shouldAbandon, and with one that always answers false, acquire is unchanged — a free lock gives a release function that HDELs its lease, a lock freed after a wait gives one too (wait_begin, then wait_end "acquired"), a lock held throughout rejects RESOURCE_CLASS_WAIT_TIMEOUT after acquireTimeoutMs (wait_end "timeout"), and it never resolves null [ADR tagging-edges/0006 D4 "Unchanged without it. With no shouldAbandon the function is unchanged and never returns null"; § Constraints "Shared queue code changes only by opt-in"; scheduled-task-timeout-propagation R2 (the phase tokens)] (passes before and after: a pin of today\'s behaviour)', async () => {
  const hooks = [['no shouldAbandon', undefined], ['a shouldAbandon that answers false', () => false]];
  const rows = [];
  for (const [hookName, hook] of hooks) {
    rows.push({ name: `${hookName}, the lock free`, hook, mode: 'free' });
    rows.push({ name: `${hookName}, the lock freed after a wait`, hook, mode: 'freed' });
    rows.push({ name: `${hookName}, the lock held throughout`, hook, mode: 'held' });
  }
  // Only the "held throughout" rows need the short give-up. The "freed after a wait" rows must see two attempts and
  // free the lock before the real semaphore's Date.now() check gives up, so a GC or scheduler pause must not fail them:
  // they get JG7's 3000 ms.
  await cases(rows, (c) => H.withStructuredLoggingOff(() => withRealSemaphore({ acquireTimeoutMs: c.mode === 'held' ? 150 : 3000 }, async ({ sem, redis, events, attempts, ends, phaseIndex }) => {
    if (c.mode !== 'free') redis.holdLease();
    const ctx = semCtx(c.hook ? { shouldAbandon: c.hook } : {});
    const t = track(sem.acquire(HEAVY, ctx));
    try {
      if (c.mode === 'freed') {
        await H.waitFor(() => attempts().length >= 2, { what: 'two lock attempts' });
        redis.releaseLease();
      }
      await within(t.promise, 2000, 'acquire');
      if (c.mode === 'held') {
        assert(t.error && t.error.code === WAIT_CODE, `a lock held throughout should reject ${WAIT_CODE}; acquire ${t.error ? `rejected ${show(t.error)}` : `resolved ${show(t.value)}`}`);
        assert(ends('timeout').length === 1 && phaseIndex('resource_class_wait_begin') >= 0, `expected wait_begin then wait_end "timeout"; events ${show(events.map((e) => [e.meta.phase, e.meta.outcome]))}`);
        return;
      }
      assert(typeof t.value === 'function', `acquire should resolve a release function; it ${t.error ? `rejected ${show(t.error)}` : `resolved ${show(t.value)}`}`);
      const held = Object.keys(redis.leases()).filter((id) => id !== 'another-task');
      assert(held.length === 1, `one lease of its own should be held; leases ${show(redis.leases())}`);
      assert(ends('acquired').length === 1, `one wait_end "acquired"; events ${show(events.map((e) => [e.meta.phase, e.meta.outcome]))}`);
      if (c.mode === 'freed') assert(phaseIndex('resource_class_wait_begin') >= 0 && phaseIndex('resource_class_wait_begin') < phaseIndex('resource_class_wait_end', 'acquired'), 'wait_begin should come before wait_end "acquired"');
      await t.value();
      assert(Object.keys(redis.leases()).length === 0, `release() should HDEL its lease; leases ${show(redis.leases())}`);
      assert(events.some((e) => e.meta.phase === 'resource_class_released'), 'release() should emit resource_class_released');
    } finally {
      await drain(t, redis);
    }
  })));
});

// ═══ JG9–JG13: the worker callback initTaskQueue builds (D3) ═════════════════════════════════════════════════

test('JG9: for the pass, initTaskQueue\'s worker callback runs D3\'s go path in order — gate.beforeAcquire(job), semaphore.acquire("neo4j-heavy", { taskName, target: "", jobId, shouldAbandon }), gate.afterAcquire(job), processor.processJob(job, taskDef), release(), gate.ended(job) — and returns processJob\'s result; the context\'s shouldAbandon() answers gate.shouldAbandon(job) on every call; the gate comes from jobGates.gateFor at init, once for the task, never per job [ADR tagging-edges/0006 D3 "The worker callback … With a gate, the resourceClass branch is: …"; "initTaskQueue resolves it once per task, when it builds that task\'s worker"]', async () => {
  await withGatedWorker({ sem: 'consult' }, async ({ log, gate, sem, processor, fakes, reg, callback }) => {
    const job = passJob(1);
    const atInit = fakes.gateForCalls.slice();
    const r = await runCallback(callback, job, log);
    const p = [];
    const want = ['beforeAcquire', 'acquire', 'shouldAbandon', 'afterAcquire', 'processJob', 'release', 'ended', 'resolved'];
    if (exact(log) !== exact(want)) p.push(`the callback should run ${show(want)} (${adr('D3')}); it ran ${show(log)} ${log.includes('beforeAcquire') ? '' : NO_GATE_SEEN(log)}`);
    if (r.error) p.push(`the callback rejected ${show(r.error)}`);
    else if (!r.value || r.value.from !== 'the processor under test') p.push(`the callback should return processJob's result; it returned ${show(r.value)}`);
    const c = sem.calls[0];
    if (!c) p.push('semaphore.acquire was never called');
    else {
      if (c.cls !== HEAVY || c.ctx.taskName !== TASK || c.ctx.target !== '' || c.ctx.jobId !== job.id) p.push(`acquire should get ("${HEAVY}", { taskName: "${TASK}", target: "", jobId: "${job.id}", shouldAbandon }); it got (${show(c.cls)}, ${show(c.ctx)})`);
      if (typeof c.ctx.shouldAbandon !== 'function') p.push(`acquire's context should carry shouldAbandon: () => gate.shouldAbandon(job) (${adr('D3')}); its keys are ${show(c.keys)}`);
      else {
        gate.opts.abandon = true;
        const second = c.ctx.shouldAbandon();
        const asked = gate.calls.filter((x) => x.name === 'shouldAbandon');
        if (second !== true) p.push(`after the gate's answer changed, the context's shouldAbandon() should answer true; it answered ${show(second)} (it must ask the gate on every call)`);
        if (!asked.length || asked.some((x) => x.jobId !== job.id)) p.push(`gate.shouldAbandon should be asked about the job; it was asked ${show(asked.map((x) => x.jobId))}`);
      }
    }
    const pj = processor.calls[0];
    if (pj && (pj.job !== job || pj.def !== reg.registry.tasks[TASK])) p.push('processJob should get the job and the task\'s registry definition');
    const gatedCalls = gate.calls.filter((x) => x.name !== 'shouldAbandon');
    if (gatedCalls.some((x) => x.job !== job)) p.push('every gate method should get the job itself');
    if (!atInit.includes(TASK)) p.push(`initTaskQueue should resolve the pass's gate with jobGates.gateFor("${TASK}") when it builds the worker; gateFor was asked ${show(atInit)}`);
    const counts = atInit.reduce((m, n) => { m[n] = (m[n] || 0) + 1; return m; }, {});
    const twice = Object.keys(counts).filter((n) => counts[n] > 1);
    if (twice.length) p.push(`gateFor should be resolved once per task; it was asked more than once for ${show(twice)}`);
    if (fakes.gateForCalls.length !== atInit.length) p.push(`gateFor was asked again while a job ran (${show(fakes.gateForCalls.slice(atInit.length))}); it is resolved at init`);
    report(p);
  });
});

test('JG10: every skip path completes the pass\'s job without spawning — beforeAcquire answering "skip" (no lock asked for), the semaphore answering null (abandoned: nothing to release, and no throw), afterAcquire answering "skip" (the lease just won released once) — each returns gate.skipped(job)\'s value, never calls processJob, and calls gate.ended(job) once [ADR tagging-edges/0006 D3: "if ((await gate.beforeAcquire(job)) === \'skip\') return gate.skipped(job)"; "if (!release) return gate.skipped(job)"; "if ((await gate.afterAcquire(job)) === \'skip\') return gate.skipped(job)"; "finally { if (release) await release(); gate.ended(job); }"; "gate.skipped(job) returns {skipped: true, jobId: job.id}, so the job completes"; AC-3 "the pass never begins running"]', async () => {
  await cases([
    { name: 'beforeAcquire answers skip', gate: { before: 'skip' }, sem: 'win', want: ['beforeAcquire', 'skipped', 'ended', 'resolved'], releases: 0 },
    { name: 'the semaphore answers null (abandoned)', gate: {}, sem: 'null', want: ['beforeAcquire', 'acquire', 'skipped', 'ended', 'resolved'], releases: 0 },
    { name: 'afterAcquire answers skip', gate: { after: 'skip' }, sem: 'win', want: ['beforeAcquire', 'acquire', 'afterAcquire', 'skipped', 'release', 'ended', 'resolved'], releases: 1 },
  ], (c) => withGatedWorker({ gate: c.gate, sem: c.sem }, async ({ log, sem, processor, callback }) => {
    const job = passJob(2);
    const r = await runCallback(callback, job, log);
    const p = [];
    if (exact(log) !== exact(c.want)) p.push(`the callback should run ${show(c.want)}; it ran ${show(log)} ${log.includes('beforeAcquire') ? '' : NO_GATE_SEEN(log)}`);
    if (r.error) p.push(`the callback should complete the job; it rejected ${show(r.error)}${r.error instanceof TypeError ? ' (a release() called when acquire answered null?)' : ''}`);
    else same(r.value, { skipped: true, jobId: job.id, from: 'the gate under test' }, 'the callback should return gate.skipped(job)\'s value');
    if (processor.calls.length) p.push(`processJob was called ${processor.calls.length} time(s); a skipped job never spawns`);
    if (sem.releases !== c.releases) p.push(`release() should be called ${c.releases} time(s); it was called ${sem.releases}`);
    if (log.filter((x) => x === 'ended').length !== 1) p.push(`gate.ended(job) should be called once; log ${show(log)}`);
    report(p);
  }));
});

test('JG11: when the heavy-lock wait gives up (RESOURCE_CLASS_WAIT_TIMEOUT), the callback awaits gate.gaveUp(job, err) and then rejects with that same error, so the job still fails as today — no processJob, no release, gate.ended once; any other acquire error is rethrown with no gaveUp [ADR tagging-edges/0006 D3: "catch (err) { if (err && err.code === \'RESOURCE_CLASS_WAIT_TIMEOUT\') await gate.gaveUp(job, err); throw err; }"; "A give-up still fails the job, as today"; AC-2 "A waiting pass that gives up"]', async () => {
  await cases([
    { name: 'a give-up', sem: 'timeout', code: WAIT_CODE, want: ['beforeAcquire', 'acquire', 'gaveUp', 'gaveUp-settled', 'ended', 'rejected'] },
    { name: 'another acquire error', sem: 'error', code: 'ECONNRESET', want: ['beforeAcquire', 'acquire', 'ended', 'rejected'] },
  ], (c) => withGatedWorker({ gate: { gaveUpMs: 30 }, sem: c.sem }, async ({ log, gate, sem, processor, callback }) => {
    const job = passJob(3);
    const r = await runCallback(callback, job, log);
    const p = [];
    if (exact(log) !== exact(c.want)) p.push(`the callback should run ${show(c.want)}; it ran ${show(log)} ${log.includes('beforeAcquire') ? '' : NO_GATE_SEEN(log)}`);
    if (!r.error || r.error.code !== c.code) p.push(`the callback should reject with the semaphore's ${c.code}; it ${r.error ? `rejected ${show(r.error)}` : `resolved ${show(r.value)}`}`);
    const g = gate.calls.find((x) => x.name === 'gaveUp');
    if (c.code === WAIT_CODE && (!g || g.jobId !== job.id || !g.extra || g.extra.code !== WAIT_CODE)) p.push(`gate.gaveUp(job, err) should get the job and the time-out error; it got ${show(g && { jobId: g.jobId, code: g.extra && g.extra.code })}`);
    if (processor.calls.length || sem.releases) p.push(`no processJob and no release on a failed acquire; processJob ${processor.calls.length}, release ${sem.releases}`);
    report(p);
  }));
});

test('JG12: gate.ended(job) is always called, and release only when a lease is held — beforeAcquire rejecting (no lock asked for, no release), afterAcquire rejecting (the lease released once), processJob rejecting (the lease released once, then ended) — and each rejection reaches the job [ADR tagging-edges/0006 D3: the whole branch is inside "try { … } finally { if (release) await release(); gate.ended(job); }"; kill-timeout-orphans-by-default R3 and scheduled-task-timeout-propagation R1 (the finally … release() pins)]', async () => {
  const boom = (what) => Object.assign(new Error(`${what} failed (test)`), { code: 'E_TEST' });
  await cases([
    { name: 'beforeAcquire rejects', gate: { beforeThrows: boom('beforeAcquire') }, processor: {}, want: ['beforeAcquire', 'ended', 'rejected'], releases: 0 },
    { name: 'afterAcquire rejects', gate: { afterThrows: boom('afterAcquire') }, processor: {}, want: ['beforeAcquire', 'acquire', 'afterAcquire', 'release', 'ended', 'rejected'], releases: 1 },
    { name: 'processJob rejects', gate: {}, processor: { throws: boom('processJob') }, want: ['beforeAcquire', 'acquire', 'afterAcquire', 'processJob', 'release', 'ended', 'rejected'], releases: 1 },
  ], (c) => withGatedWorker({ gate: c.gate, processor: c.processor, sem: 'win' }, async ({ log, sem, callback }) => {
    const r = await runCallback(callback, passJob(4), log);
    const p = [];
    if (exact(log) !== exact(c.want)) p.push(`the callback should run ${show(c.want)}; it ran ${show(log)} ${log.includes('beforeAcquire') ? '' : NO_GATE_SEEN(log)}`);
    if (!r.error || r.error.code !== 'E_TEST') p.push(`the error should reach the job; the callback ${r.error ? `rejected ${show(r.error)}` : `resolved ${show(r.value)}`}`);
    if (sem.releases !== c.releases) p.push(`release() should be called ${c.releases} time(s); it was called ${sem.releases}`);
    report(p);
  }));
});

test('JG13: every other task\'s callback is today\'s — a tagged task whose gate is null acquires with exactly { taskName, target (its customer\'s pubkey), jobId }, runs processJob, releases, and on a give-up rejects without any gate call; an untagged task runs processJob alone; no gate method is ever called for them [ADR tagging-edges/0006 D3 "For a task whose gate is null the callback is today\'s, byte for byte"; § Constraints "Shared queue code changes only by opt-in … must leave every other task\'s behaviour unchanged"] (passes before and after: a pin of today\'s behaviour)', async () => {
  const customer = 'b'.repeat(64);
  await cases([
    { name: 'another tagged task', task: 'otherTagged', sem: 'win', data: { customerArgs: { pubkey: customer } }, want: ['acquire', 'processJob', 'release', 'resolved'], target: customer },
    { name: 'another tagged task that gives up', task: 'otherTagged', sem: 'timeout', data: {}, want: ['acquire', 'rejected'], target: '' },
    { name: 'an untagged task', task: 'untagged', sem: 'win', data: {}, want: ['processJob', 'resolved'] },
  ], (c) => withGatedWorker({ sem: c.sem }, async ({ log, gate, sem, processor, reg, workerOf }) => {
    const name = reg[c.task];
    const w = workerOf(name);
    assert(w && typeof w.fn === 'function', `setup: initTaskQueue should build a Worker for ${name}`);
    const job = { id: `${name}-job`, name, timestamp: T0, data: { taskName: name, customerArgs: null, ...c.data } };
    const r = await runCallback(w.fn, job, log);
    const p = [];
    if (exact(log) !== exact(c.want)) p.push(`${name}'s callback should run ${show(c.want)}; it ran ${show(log)}`);
    if (gate.calls.length) p.push(`the pass's gate was called for ${name}: ${show(gate.calls.map((x) => x.name))}`);
    if (c.want.includes('acquire')) {
      const call = sem.calls[0];
      if (!call || exact(call.keys) !== exact(['jobId', 'target', 'taskName']) || call.ctx.taskName !== name || call.ctx.jobId !== job.id || call.ctx.target !== c.target) {
        p.push(`${name} should acquire with exactly { taskName, target, jobId }; it got ${show(call && call.ctx)}`);
      }
    }
    if (c.sem === 'timeout' && (!r.error || r.error.code !== WAIT_CODE)) p.push(`the give-up should fail the job; it ${r.error ? `rejected ${show(r.error)}` : 'resolved'}`);
    if (c.sem === 'win' && processor.calls.length !== 1) p.push(`processJob should run once; it ran ${processor.calls.length} time(s)`);
    report(p);
  }));
});

// ═══ JG14–JG25: the controller's gate (D1, D3) ═══════════════════════════════════════════════════════════════

test('JG14: createController(deps).gate has beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp and skipped, built by gate.js\'s makeGate; gate.skipped(job) answers exactly { skipped: true, jobId: job.id }; and two controllers keep separate state — a job launched and ended through one is still waiting, as never seen, in the other\'s snapshot [ADR tagging-edges/0006 D1 "gate.js: exports makeGate(state, deps) … It holds no state of its own"; "createController(deps) … with the chain, all marks and the status cache on the instance"; "Tests build their own instance"; D3 "gate.skipped(job) returns {skipped: true, jobId: job.id}"]', async () => {
  H.loadModule(MODULES.gate, { makeGate: 'function' }, adr('D1'));
  await withWorld({}, async (world) => {
    const a = newController(world);
    const b = newController(world);
    const p = [];
    const plain = { id: H.lineUpKey(14), name: TASK, timestamp: T0, data: H.lineUpData() };
    same(await gateCall(a.gate.skipped(plain), 'gate.skipped'), { skipped: true, jobId: plain.id }, `gate.skipped(job) (${adr('D3')})`);
    const K = H.lineUpKey(15);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG14');
    await must(a.gate.beforeAcquire(job), 'go', 'A\'s beforeAcquire');
    await must(a.gate.afterAcquire(job), 'go', 'A\'s afterAcquire');
    const ia = itemFor(await itemsNow(a, world), K);
    const ib = itemFor(await itemsNow(b, world), K);
    if (!ia || ia.state !== 'running') p.push(`controller A launched ${K}, so its snapshot should list it running (starting); it lists ${show(ia)}`);
    if (!ib || ib.state !== 'waiting' || ib.behind !== null) p.push(`controller B's gate never saw ${K}, so its snapshot should list it as an active job with no phase: waiting, behind null (${adr('D5')}); it lists ${show(ib)}`);
    a.gate.ended(job);
    const ia2 = itemFor(await itemsNow(a, world), K);
    const ib2 = itemFor(await itemsNow(b, world), K);
    if (ia2) p.push(`after A's gate.ended, A should treat the still-active job as ending, not busy; it lists ${show(ia2)}`);
    if (!ib2) p.push('A\'s gate.ended changed controller B\'s view: B should still list the job, as never seen');
    report(p);
  });
});

test('JG15: beforeAcquire answers "skip" for a job whose record entry has skip or noRerun — read by a controller that never marked it (a restart) — including a legacy fixed-id job, whose entry is keyed reconcileTaggingEdges@<timestamp>; it answers "go" for the same record\'s unmarked keys and for the legacy id at another timestamp [ADR tagging-edges/0006 D3 "If the key is in skips or noRerun, or the record\'s entry has skip or noRerun, answer \'skip\'"; D2 "The job key … `${job.id}@${job.timestamp}`"; D9 "beforeAcquire skips it through noRerun, when the stop was recorded"; R2; R7]', async () => {
  const at = iso(T0 - 20 * MIN);
  const start = { at, who: OWNER_WHO };
  const KS = H.lineUpKey(21);
  const KN = H.lineUpKey(22);
  const KG = H.lineUpKey(23);
  const ts1 = T0 - 3 * 60 * MIN;
  const ts2 = T0 - 2 * 60 * MIN;
  const legacyKey = `${LEGACY_ID}@${ts1}`;
  const record = H.recordFile({
    passes: {
      [KS]: H.recordEntry({ jobId: KS, start, stop: { at, runId: null, who: ADMIN_WHO }, skip: true }),
      [KN]: H.recordEntry({ jobId: KN, start, stop: { at, runId: H.runIdAt(T0 - 21 * MIN), who: ADMIN_WHO }, noRerun: true }),
      [KG]: H.recordEntry({ jobId: KG, start }),
      [legacyKey]: H.recordEntry({ jobId: LEGACY_ID, start: { at: iso(ts1), who: { kind: 'other' } }, stop: { at, runId: null, who: OWNER_WHO }, skip: true }),
    },
    history: [],
  });
  await withWorld({ record: { record } }, async (world) => {
    const ctl = newController(world);
    const job = (id, timestamp = T0 - MIN) => ({ id, name: TASK, timestamp, data: H.lineUpData() });
    await cases([
      { name: 'skip in the record', job: job(KS), want: 'skip' },
      { name: 'noRerun in the record (a stalled re-run after a restart)', job: job(KN), want: 'skip' },
      { name: 'an unmarked key with a start', job: job(KG), want: 'go' },
      { name: 'the legacy id at the marked timestamp', job: job(LEGACY_ID, ts1), want: 'skip' },
      { name: 'the legacy id at another timestamp', job: job(LEGACY_ID, ts2), want: 'go' },
    ], async (c) => {
      const got = await gateCall(ctl.gate.beforeAcquire(c.job), `beforeAcquire(${c.job.id})`);
      assert(got === c.want, `beforeAcquire should answer ${show(c.want)} (${adr('D3')}); it answered ${show(got)}`);
    });
  });
});

test('JG16: beforeAcquire answers "skip" from the in-memory marks alone, when the Stop could not write the record — a waiting job a Stop took out of line, at its pickup; and the stalled re-run of a job whose running pass a Stop asked to stop (noRerun) — and the record on disk shows neither mark [ADR tagging-edges/0006 D3 "If the key is in skips or noRerun … answer \'skip\'"; D9 step 4 "First, the effect in memory … A failed or refused write leaves the effect in place and sets recorded: false"; D9 "Its job then completes without spawning … when it is picked up"; AC-5 "a Stop still takes effect"]', async () => {
  await cases([
    { name: 'a waiting job taken out of line', running: false },
    { name: 'a running pass asked to stop, then its stalled re-run', running: true },
  ], (c) => withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(c.running ? 31 : 30);
    world.record.set(ownerStartRecord(K));
    const bytesBefore = world.record.bytes();
    let job;
    if (c.running) {
      job = await runningPass(world, ctl, K);
      world.record.failWrites('ENOSPC');
      const r = await stopRunning(world, ctl, K);
      stopDid(r, 'asked-to-stop', c.name);
      world.queue.stall(K);
      job = pickUp(world, K, 'the stalled re-run');
    } else {
      await addJob(world, K);
      world.record.failWrites('ENOSPC');
      const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
      stopDid(r, 'taken-out-of-line', c.name);
      job = pickUp(world, K, 'the stopped job');
    }
    world.record.heal();
    assert(world.record.bytes() === bytesBefore, `setup: the Stop's record write should have failed, leaving the record as it was; it is ${show(world.record.parsed())}`);
    const got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire');
    assert(got === 'skip', `beforeAcquire should answer "skip" from the Stop's in-memory ${c.running ? 'noRerun' : 'skips'} mark (${adr('D3')}, ${adr('D9')}); it answered ${show(got)}`);
  }));
});

test('JG17: a scheduled run with no start in the record — the seed backstop\'s id form repeat:sched:seed:reconcileTaggingEdges:<millis>, picked up 30 minutes late — gets its start recorded at beforeAcquire as { kind: "schedule" } at the id\'s millis, not at pickup, with its history line placed by time behind a newer one; beforeAcquire answers "go"; a second beforeAcquire for that key, from this controller or a fresh one (a restart), adds no second start [ADR tagging-edges/0006 D3 "A scheduled job (id starts repeat:sched:) with no start in the record: record the start as {kind: \'schedule\'}, at = the id\'s millis"; D2 "\'The id\'s millis\' means the digits after a scheduled job id\'s last \':\'"; D11 "history is newest first, at most 10, and sorted by at, because a schedule start can be written late"; AC-5 "the schedule, for a run a Scheduled Tasks entry starts"]', async () => {
  const M = T0 - 30 * MIN;
  const K0 = H.lineUpKey(40);
  await withWorld({ record: { record: ownerStartRecord(K0, T0 - 10 * MIN) } }, async (world) => {
    const ctl = newController(world);
    const S = world.queue.plantScheduled({ millis: M });
    assert(S === H.scheduledJobId(H.SEED_ENTRY_ID, M), `setup: the planted job should have the seed id form; it is ${S}`);
    const job = pickUp(world, S, 'the due scheduled run');
    const before = parsed(world);
    const got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire');
    const p = [];
    if (got !== 'go') p.push(`beforeAcquire should answer "go"; it answered ${show(got)}`);
    const rec = parsed(world);
    const entry = (rec.passes || {})[S];
    const wantStart = { at: iso(M), who: { kind: 'schedule' } };
    if (!entry || entry.jobId !== S || exact(entry.start) !== exact(wantStart) || entry.stop) p.push(`the record should hold passes["${S}"] with jobId "${S}" and start ${show(wantStart)} (${adr('D3')}, ${adr('D11')}); it holds ${show(entry)}`);
    const lines = startLines(rec, S);
    if (lines.length !== 1 || exact(lines[0]) !== exact({ action: 'start', key: S, at: iso(M), who: { kind: 'schedule' } })) p.push(`history should gain one start line for ${S} at the id's millis; it has ${show(lines)}`);
    const order = (rec.history || []).map((l) => l.key);
    if (exact(order) !== exact([K0, S])) p.push(`history should be newest first by at: the owner's start (${iso(T0 - 10 * MIN)}) before the schedule's (${iso(M)}); it is ${show(order)}`);
    if (exact((rec.passes || {})[K0]) !== exact(before.passes[K0])) p.push(`the owner's entry should be unchanged; it is ${show((rec.passes || {})[K0])}`);
    for (const [label, gateOf] of [['the same controller', () => ctl.gate], ['a fresh controller', () => newController(world).gate]]) {
      // eslint-disable-next-line no-await-in-loop
      const again = await gateCall(gateOf().beforeAcquire(job), `beforeAcquire again (${label})`);
      const now = parsed(world);
      if (again !== 'go') p.push(`${label}: beforeAcquire again should answer "go"; it answered ${show(again)}`);
      if (startLines(now, S).length !== 1 || exact((now.passes || {})[S] && now.passes[S].start) !== exact(wantStart)) p.push(`${label}: a second beforeAcquire should add no second start; history ${show(startLines(now, S))}, start ${show((now.passes || {})[S])}`);
    }
    report(p);
  });
});

test('JG18: a schedule\'s start cannot be refused — when the record write fails, beforeAcquire still answers "go" and the run goes on waiting for the lock; when the record gives a read error, nothing writes or renames it (it is unchanged, byte for byte) and beforeAcquire answers "go" [ADR tagging-edges/0006 D3 "A schedule\'s start cannot be refused, so a failed write goes ahead unrecorded"; D11 "While it still gives a read error, nothing writes it: … a schedule, confirmation or other start goes ahead unrecorded"; § Seams "A record that gives a read error is unchanged, byte for byte, after … a scheduled start"; AC-5 "a start that cannot be refused (a schedule\'s …) goes ahead, and shows as not recorded"]', async () => {
  await cases([
    { name: 'the write fails', fault: (w) => w.record.failWrites('ENOSPC') },
    { name: 'the record gives a read error', fault: (w) => w.record.failReads('EIO'), untouched: true },
  ], (c) => withWorld({ record: { record: ownerStartRecord(H.lineUpKey(41)) } }, async (world) => {
    const ctl = newController(world);
    const M = T0 - 5 * MIN;
    const S = world.queue.plantScheduled({ millis: M });
    const job = pickUp(world, S, 'the due scheduled run');
    c.fault(world);
    const bytes = world.record.bytes();
    const writesBefore = world.callsOf('writeRecord').length;
    const renamesBefore = world.callsOf('renameRecord').length;
    let got;
    try { got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire'); } catch (e) { throw new Error(`beforeAcquire should answer "go" whatever the record does (${adr('D3')}); it threw ${firstLine(e)}`); }
    const p = [];
    if (got !== 'go') p.push(`beforeAcquire should answer "go"; it answered ${show(got)}`);
    const it = itemFor(await itemsNow(ctl, world), S);
    if (!it || it.state !== 'waiting' || it.behind !== 'heavy-work') p.push(`the run should go on, waiting for the lock (behind "heavy-work", ${adr('D5')}); the snapshot lists ${show(it)}`);
    if (c.untouched) {
      const w = world.callsOf('writeRecord').length - writesBefore;
      const r = world.callsOf('renameRecord').length - renamesBefore;
      if (w || r) p.push(`a record that gives a read error must not be written or renamed (${adr('D11')}); it was written ${w} and renamed ${r} time(s)`);
      if (world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    }
    report(p);
  }));
});

test('JG19: "started another way" — beforeAcquire records { kind: "other" } at job.timestamp, best effort, for a key that does not match LINEUP_ID and that this controller did not line up: a legacy fixed-id job (keyed reconcileTaggingEdges@<timestamp>, jobId "reconcileTaggingEdges") and a dashboard add with BullMQ\'s own numeric id; a failed write still answers "go" — but never for a LINEUP_ID-shaped key it did not line up, for a key lineUp made whose start could not be recorded (the confirm route\'s, with the record failing), or for a key whose start is already recorded [ADR tagging-edges/0006 D3 "Another job the record does not know: record the start {kind: \'other\'} at job.timestamp, best effort. This applies to a key that does not match LINEUP_ID and is not in linedUp. A lineUp-made key with no start (its record write failed) stays unrecorded, as AC-5 requires"; D2; D8; R3; R7; AC-5 "started another way"]', async () => {
  const TS = T0 - 10 * MIN;
  const p = [];
  // the legacy fixed id, and BullMQ's own counter id
  for (const c of [{ name: 'the legacy fixed id', id: LEGACY_ID }, { name: 'a dashboard add with BullMQ\'s numeric id', id: undefined }]) {
    // eslint-disable-next-line no-await-in-loop
    await withWorld({}, async (world) => {
      const ctl = newController(world);
      world.clock.set(TS);
      const added = await addJob(world, c.id);
      world.clock.set(T0);
      const job = pickUp(world, added.id, c.name);
      const key = c.id === LEGACY_ID ? `${LEGACY_ID}@${TS}` : String(job.id);
      const got = await gateCall(ctl.gate.beforeAcquire(job), `beforeAcquire (${c.name})`);
      if (got !== 'go') p.push(`${c.name}: beforeAcquire should answer "go"; it answered ${show(got)}`);
      const rec = parsed(world);
      const entry = (rec.passes || {})[key];
      const want = { at: iso(TS), who: { kind: 'other' } };
      if (!entry || entry.jobId !== String(job.id) || exact(entry.start) !== exact(want)) p.push(`${c.name}: the record should hold passes["${key}"] { jobId: "${job.id}", start: ${show(want)} } (${adr('D3')}); it holds ${show(rec.passes)}`);
      if (startLines(rec, key).length !== 1) p.push(`${c.name}: history should hold one start line for ${key}; it holds ${show(rec.history)}`);
    });
  }
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const added = await addJob(world, 'from-the-dashboard');
    const job = pickUp(world, added.id, 'a best-effort other start');
    world.record.failWrites('EIO');
    let got;
    try { got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire with the write failing'); } catch (e) { got = `threw ${firstLine(e)}`; }
    if (got !== 'go') p.push(`an "other" start is best effort: with the write failing, beforeAcquire should answer "go"; it answered ${show(got)}`);
  });
  // never "other"
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(50);
    await addJob(world, K);
    const job = pickUp(world, K, 'a LINEUP_ID key from another process');
    const got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire (a LINEUP_ID key not lined up here)');
    if (got !== 'go') p.push(`a LINEUP_ID key not lined up here: beforeAcquire should answer "go"; it answered ${show(got)}`);
    const rec = parsed(world);
    if ((rec.passes || {})[K] || startLines(rec, K).length) p.push(`a LINEUP_ID-shaped key is never "started another way" (${adr('D3')}: "a key that does not match LINEUP_ID"); the record holds ${show(rec)}`);
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    world.record.failWrites('ENOSPC');
    await gateCall(ctl.lineUp({ who: { kind: 'confirmation' }, mode: 'confirm' }), 'lineUp (confirm)');
    const K = world.keys[world.keys.length - 1];
    assert(K && world.queue.has(K), `setup: the confirm route's lineUp should add a job even when the record cannot be written (${adr('D8')}: "an unreadable record or a failed write goes ahead unrecorded"); keys ${show(world.keys)}, queue ${show(world.queue.dump())}`);
    world.record.heal();
    const job = pickUp(world, K, 'the confirm route\'s job');
    const got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire (a lineUp key with no start)');
    if (got !== 'go') p.push(`a lineUp key with no start: beforeAcquire should answer "go"; it answered ${show(got)}`);
    const rec = parsed(world);
    const entry = (rec.passes || {})[K];
    if ((entry && entry.start) || startLines(rec, K).length) p.push(`a key lineUp made whose start could not be recorded stays unrecorded (${adr('D3')}; AC-5); the record holds ${show(entry)} and ${show(startLines(rec, K))}`);
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    world.clock.set(TS);
    await addJob(world, LEGACY_ID);
    world.clock.set(T0);
    const key = `${LEGACY_ID}@${TS}`;
    const rec0 = H.recordFile({ passes: { [key]: H.recordEntry({ jobId: LEGACY_ID, start: { at: iso(TS), who: { kind: 'other' } } }) }, history: [H.historyLine('start', key, iso(TS), { kind: 'other' })] });
    world.record.set(rec0);
    const job = pickUp(world, LEGACY_ID, 'a stalled legacy job already recorded');
    await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire (start already recorded)');
    if (startLines(parsed(world), key).length !== 1) p.push(`a key whose start is recorded gets no second start; history ${show(parsed(world).history)}`);
  });
  report(p);
});

test('JG20: beforeAcquire\'s "go" sets the job\'s phase to waiting-for-lock — an active job the gate had not seen (waiting, behind null) is then listed waiting behind "heavy-work", and a snapshot taken without fresh still shows the change — while no gate method reads the queue (Redis), and an owner\'s start already recorded by lineUp gets no write [ADR tagging-edges/0006 D3 "Then set phases[key] = {jobId: job.id, phase: \'waiting-for-lock\', since: now} and answer \'go\'"; "What the gate does not decide. It never reads Redis. It records no who for an owner, admin, local or confirmation start"; D5 "Active, with phase waiting-for-lock → waiting … behind: \'heavy-work\'"; "Active with no phase … → waiting … behind: null"; "the gate\'s phase … changes" bump generation]', async () => {
  const K = H.lineUpKey(60);
  await withWorld({ record: { record: ownerStartRecord(K) } }, async (world) => {
    const ctl = newController(world);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG20');
    const p = [];
    const before = itemFor(await itemsNow(ctl, world, false), K);
    if (!before || before.state !== 'waiting' || before.behind !== null) p.push(`setup: an active job the gate has not seen is waiting, behind null (${adr('D5')}); the snapshot lists ${show(before)}`);
    const q0 = queueCalls(world);
    const w0 = world.callsOf('writeRecord').length;
    const got = await gateCall(ctl.gate.beforeAcquire(job), 'beforeAcquire');
    const qBefore = queueCalls(world) - q0;
    const wBefore = world.callsOf('writeRecord').length - w0;
    if (got !== 'go') p.push(`beforeAcquire should answer "go"; it answered ${show(got)}`);
    const after = itemFor(await itemsNow(ctl, world, false), K);
    if (!after || after.state !== 'waiting' || after.behind !== 'heavy-work') p.push(`after beforeAcquire's "go", the job should be listed waiting behind "heavy-work", even in a snapshot taken without fresh (${adr('D3')}, ${adr('D5')}); it is ${show(after)}`);
    const q1 = queueCalls(world);
    const abandon = ctl.gate.shouldAbandon(job);
    await gateCall(ctl.gate.afterAcquire(job), 'afterAcquire');
    ctl.gate.ended(job);
    const qRest = queueCalls(world) - q1;
    if (qBefore || qRest) p.push(`the gate read the queue: ${qBefore} call(s) in beforeAcquire, ${qRest} in shouldAbandon, afterAcquire and ended (${adr('D3')}: "It never reads Redis")`);
    if (abandon !== false) p.push(`setup: shouldAbandon should be false for an unmarked job; it answered ${show(abandon)}`);
    if (wBefore) p.push(`beforeAcquire wrote the record ${wBefore} time(s) for a start lineUp already recorded (${adr('D3')}: "It records no who for an owner … start")`);
    report(p);
  });
});

test('JG21: shouldAbandon(job) is synchronous and answers a boolean, skips ∪ noRerun — false for a job waiting for the lock with no mark, true once a Stop takes it out of line, false for an unrelated key, and true for a job whose running pass a Stop asked to stop [ADR tagging-edges/0006 D3 "shouldAbandon is synchronous: skips.has(key) || noRerun.has(key). noRerun matters here only for a stalled re-run"; D4 (the semaphore calls it in its loop); D9 "at its next lock poll, within 500 ms, through shouldAbandon"]', async () => {
  const p = [];
  const boolOf = (v, what) => {
    if (isThenable(v)) { p.push(`${what}: shouldAbandon returned a promise, which the semaphore would read as true; it must answer a boolean at once (${adr('D3')})`); return undefined; }
    if (typeof v !== 'boolean') p.push(`${what}: shouldAbandon should answer a boolean; it answered ${show(v)}`);
    return v;
  };
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(70);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG21 waiting');
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    if (boolOf(ctl.gate.shouldAbandon(job), 'unmarked') !== false) p.push('an unmarked job waiting for the lock should not be abandoned');
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    stopDid(r, 'taken-out-of-line', 'JG21');
    if (boolOf(ctl.gate.shouldAbandon(job), 'taken out of line') !== true) p.push(`after a Stop took ${K} out of line, shouldAbandon should answer true (${adr('D3')}: skips.has(key))`);
    const other = { id: H.lineUpKey(71), name: TASK, timestamp: T0, data: H.lineUpData() };
    if (boolOf(ctl.gate.shouldAbandon(other), 'unrelated') !== false) p.push('an unrelated key should not be abandoned');
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(72);
    const job = await runningPass(world, ctl, K);
    await stopRunning(world, ctl, K);
    if (boolOf(ctl.gate.shouldAbandon(job), 'noRerun') !== true) p.push(`after a Stop asked the running pass of ${K} to stop, shouldAbandon should answer true for that job (${adr('D3')}: noRerun.has(key))`);
  });
  report(p);
});

test('JG22: afterAcquire is the waiting→running boundary — its "go" sets the phase launched (listed running, runId null, since the moment afterAcquire ran), after which a Stop whose prompt said waiting is refused prompt-out-of-date and marks nothing; a Stop that came first makes it answer "skip"; and a job whose running pass was asked to stop (noRerun) gets "skip" [ADR tagging-edges/0006 D3 "afterAcquire (in the chain): if the key is in skips or noRerun, answer \'skip\'. Otherwise set phases[key] = {jobId, phase: \'launched\', since: now} and answer \'go\'. This chain step is the waiting→running boundary"; D5 "otherwise → running, starting: since: phases.since, runId: null"; D9 step 2 "Stale prompt"; AC-3 "If what is busy has changed since the prompt opened (a waiting pass has begun running …), the stop is refused plainly and changes nothing"]', async () => {
  const p = [];
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(80);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG22 go');
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    world.clock.advance(4000);
    const got = await gateCall(ctl.gate.afterAcquire(job), 'afterAcquire');
    if (got !== 'go') p.push(`afterAcquire should answer "go" for an unmarked job; it answered ${show(got)}`);
    const it = itemFor(await itemsNow(ctl, world), K);
    if (!it || it.state !== 'running' || it.runId !== null || toMs(it.since) !== T0 + 4000) p.push(`after afterAcquire's "go" the job should be listed running, runId null, since ${iso(T0 + 4000)} (${adr('D5')}: since: phases.since); it is ${show(it)}`);
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    if (!textOf(r).includes('"prompt-out-of-date"')) p.push(`a Stop whose prompt said waiting, after the boundary, should be refused prompt-out-of-date (${adr('D9')}); stop() answered ${show(r)}`);
    if (ctl.gate.shouldAbandon(job) !== false) p.push('the refused Stop should mark nothing');
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(81);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG22 stop first');
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    stopDid(r, 'taken-out-of-line', 'JG22 stop first');
    const got = await gateCall(ctl.gate.afterAcquire(job), 'afterAcquire');
    if (got !== 'skip') p.push(`a Stop that ran before afterAcquire took the job out of line, so afterAcquire should answer "skip" (${adr('D3')} "Stop first"); it answered ${show(got)}`);
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(82);
    const job = await runningPass(world, ctl, K);
    await stopRunning(world, ctl, K);
    const got = await gateCall(ctl.gate.afterAcquire(job), 'afterAcquire (noRerun)');
    if (got !== 'skip') p.push(`a job whose running pass was asked to stop is in noRerun, so afterAcquire should answer "skip"; it answered ${show(got)}`);
  });
  report(p);
});

test('JG23: beforeAcquire and afterAcquire are chain steps — each called while a Stop\'s step is still reading the queue does not answer until that step ends, and then answers "skip" because the Stop took the job out of line [ADR tagging-edges/0006 D1 "The chain … Every step runs as step = chain.then(fn)"; "These join the chain: … the worker\'s per-job decisions"; D3 "beforeAcquire (in the chain)"; "afterAcquire (in the chain) … serialised"; "Stop first. A Stop step that ran before it saw the pass as waiting and put it in skips, so this step skips it"]', async () => {
  await cases([
    { name: 'afterAcquire, for a job waiting for the lock', method: 'afterAcquire', primed: true },
    { name: 'beforeAcquire, for a job just picked up', method: 'beforeAcquire', primed: false },
  ], (c) => withWorld({ timers: { stepMs: 2000 } }, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(c.primed ? 90 : 91);
    await addJob(world, K);
    const job = pickUp(world, K, c.name);
    if (c.primed) await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    world.queue.inject('getActive', { hang: true });
    const stop = track(ctl.stop({ who: ADMIN_WHO, targets: [{ key: K, state: 'waiting' }] }));
    let gateStep = null;
    try {
      await H.waitFor(() => world.queue.pendingHangs() >= 1, { what: 'the Stop\'s step to reach its queue read' });
      gateStep = track(ctl.gate[c.method](job));
      await H.sleep(40);
      const early = gateStep.settled;
      world.queue.releaseHangs();
      await within(stop.promise, 3000, 'stop()');
      await within(gateStep.promise, 3000, c.method);
      const p = [];
      if (early) p.push(`${c.method} answered ${show(gateStep.value)} while the Stop's step was still running; it must wait its turn in the chain (${adr('D3')}, ${adr('D1')})`);
      stopDid(stop.value, 'taken-out-of-line', c.name);
      if (gateStep.error) p.push(`${c.method} rejected ${show(gateStep.error)}`);
      else if (gateStep.value !== 'skip') p.push(`after the Stop's step, ${c.method} should answer "skip"; it answered ${show(gateStep.value)}`);
      report(p);
    } finally {
      world.queue.releaseHangs();
      await within(stop.promise, 3000, 'stop()').catch(() => {});
      if (gateStep) await within(gateStep.promise, 3000, c.method).catch(() => {});
    }
  }));
});

test('JG24: gate.ended(job) is synchronous and in memory — a launched job still active in its finishing window stops being busy at once (even in a snapshot taken without fresh), the job\'s in-memory skips mark is dropped (shouldAbandon true before, false after), and the ended mark itself is dropped after endedKeysMs, when a job still active under that key shows again [ADR tagging-edges/0006 D3 "ended: delete phases[key]; set endedKeys[key] = now; drop the in-memory skips and noRerun for the key, since the record keeps both; bump generation"; "gate.ended is synchronous and in memory, never a chain step"; D1 "endedKeys: Map(key → endedAt), filled by gate.ended, entries dropped after 10 s"; D5 "Active, with phase launched … else, if the key is in endedKeys → ending"; AC-1 "Just after a pass ends"]', async () => {
  const p = [];
  // This half waits the ended-keys window out, so it shortens it from FAST_TIMERS' 2000 ms to 200 ms.
  await withWorld({ timers: { endedKeysMs: 200 } }, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(100);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG24 finishing window');
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    await must(ctl.gate.afterAcquire(job), 'go', 'afterAcquire');
    const before = itemFor(await itemsNow(ctl, world, false), K);
    if (!before || before.state !== 'running') p.push(`setup: a launched job is listed running; it is ${show(before)}`);
    const r = ctl.gate.ended(job);
    if (isThenable(r)) p.push(`gate.ended returned a promise; it is synchronous (${adr('D3')})`);
    const after = itemFor(await itemsNow(ctl, world, false), K);
    if (after) p.push(`right after gate.ended, the still-active job is ending, not busy, even in a cached snapshot (${adr('D3')}: bump generation; ${adr('D5')}); it is listed ${show(after)}`);
    const wait = world.deps.timers.endedKeysMs + 150;
    await H.sleep(wait);
    world.clock.advance(wait);
    const later = itemFor(await itemsNow(ctl, world), K);
    if (!later || later.state !== 'waiting' || later.behind !== null) p.push(`after endedKeysMs (${world.deps.timers.endedKeysMs} ms) the ended mark should be dropped (${adr('D1')}), so a job still active under that key is an active job with no phase again: waiting, behind null; it is ${show(later)}`);
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const K = H.lineUpKey(101);
    await addJob(world, K);
    const job = pickUp(world, K, 'JG24 skips');
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    stopDid(r, 'taken-out-of-line', 'JG24 skips');
    const marked = ctl.gate.shouldAbandon(job);
    ctl.gate.ended(job);
    const cleared = ctl.gate.shouldAbandon(job);
    if (marked !== true || cleared !== false) p.push(`gate.ended should drop the in-memory skips mark: shouldAbandon was ${show(marked)} before and ${show(cleared)} after (want true, then false)`);
  });
  report(p);
});

test('JG25: gate.gaveUp(job, err) records gaveUpAt = now on the job\'s entry, leaving its start and the history as they were (a give-up is not an action), and always resolves — with the record write failing, and with the record giving a read error, when nothing writes or renames it [ADR tagging-edges/0006 D3 "gaveUp: set lastGaveUp = {key, at: now}; record gaveUpAt on the job\'s entry, best effort; bump generation"; D11 (history actions are start and stop; "While it still gives a read error, nothing writes it: … gaveUpAt is not recorded"); AC-2 "A waiting pass that gives up … leaves no pass report, and the history keeps its start"]', async () => {
  const K = H.lineUpKey(110);
  const err = Object.assign(new Error(`Could not acquire resource class "${HEAVY}" (test). ${WAIT_CODE}.`), { code: WAIT_CODE });
  await cases([
    { name: 'the record writes', fault: null },
    { name: 'the record write fails', fault: (w) => w.record.failWrites('ENOSPC') },
    { name: 'the record gives a read error', fault: (w) => w.record.failReads('EIO'), untouched: true },
  ], (c) => withWorld({ record: { record: ownerStartRecord(K) } }, async (world) => {
    const ctl = newController(world);
    await addJob(world, K);
    const job = pickUp(world, K, c.name);
    const before = parsed(world);
    // Before the controller's first read: D11 has a step re-read the record only when its last read was not readable.
    if (c.fault) c.fault(world);
    await must(ctl.gate.beforeAcquire(job), 'go', 'beforeAcquire');
    world.clock.advance(60 * MIN);
    const bytes = world.record.bytes();
    const w0 = world.callsOf('writeRecord').length;
    const r0 = world.callsOf('renameRecord').length;
    try { await gateCall(ctl.gate.gaveUp(job, err), 'gaveUp'); } catch (e) { throw new Error(`gaveUp should always resolve (best effort, ${adr('D3')}); it rejected ${firstLine(e)}`); }
    const p = [];
    if (c.untouched) {
      if (world.callsOf('writeRecord').length !== w0 || world.callsOf('renameRecord').length !== r0) p.push(`a record that gives a read error must not be written or renamed (${adr('D11')})`);
      if (world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    } else if (!c.fault) {
      const rec = parsed(world);
      const entry = (rec.passes || {})[K];
      if (!entry || entry.gaveUpAt !== iso(world.clock.now())) p.push(`the entry should record gaveUpAt ${iso(world.clock.now())} (${adr('D3')}); it is ${show(entry)}`);
      if (entry && exact(entry.start) !== exact(before.passes[K].start)) p.push(`the start should be unchanged; it is ${show(entry.start)}`);
      if (exact(rec.history) !== exact(before.history)) p.push(`a give-up adds nothing to the history; it is ${show(rec.history)}`);
    }
    report(p);
  }));
});

// ═══ JG26: the ADR's worker callback over the controller's gate ═══════════════════════════════════════════════

test('JG26: through D3\'s worker callback over the controller\'s gate — a Stop before pickup completes the job at beforeAcquire without asking for the lock; a Stop while the pass waits behind other heavy work completes it at the next lock poll (abandoned); in both the processor never runs and the on-demand job is removed; a pass that runs has processJob called once and the lease released once; a give-up fails the job, records gaveUpAt and removes the job [ADR tagging-edges/0006 D3; D4; D9 "A waiting target\'s effect … Its job then completes without spawning: at its next lock poll, within 500 ms, through shouldAbandon; or when it is picked up"; AC-3 "Confirming a stop of a waiting pass: the pass never begins running"; AC-2 "A waiting pass that gives up"]', async () => {
  const p = [];
  const cb = (ctl, sem, proc) => H.adrWorkerCallback({ gate: ctl.gate, semaphore: sem, processor: proc, taskDef: { resourceClass: HEAVY } });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const sem = H.makeScriptedSemaphore({ free: true });
    const proc = H.makeFakeProcessor(world);
    const K = H.lineUpKey(120);
    await addJob(world, K);
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    stopDid(r, 'taken-out-of-line', 'a Stop before pickup');
    const w = world.queue.work(cb(ctl, sem, proc));
    const done = await within(w.done, 2000, 'the stopped job');
    if (done.outcome !== 'completed' || exact(done.returnvalue) !== exact({ skipped: true, jobId: K })) p.push(`a Stop before pickup: the job should complete with { skipped: true, jobId }; it ended ${show({ outcome: done.outcome, returnvalue: done.returnvalue, error: done.error && firstLine(done.error) })}`);
    if (sem.calls.length || proc.calls.length) p.push(`a Stop before pickup: no lock asked for (${sem.calls.length}) and no spawn (${proc.calls.length})`);
    if (world.queue.has(K)) p.push('a Stop before pickup: the completed on-demand job should be removed');
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const sem = H.makeScriptedSemaphore({ free: false, acquireTimeoutMs: 3000 });
    const proc = H.makeFakeProcessor(world);
    const K = H.lineUpKey(121);
    await addJob(world, K);
    const w = world.queue.work(cb(ctl, sem, proc));
    await H.waitFor(async () => { const it = itemFor(await itemsNow(ctl, world), K); return it && it.behind === 'heavy-work'; }, { what: 'the job to wait behind other heavy work' });
    const r = await stopNow(ctl, [{ key: K, state: 'waiting' }]);
    stopDid(r, 'taken-out-of-line', 'a Stop while waiting for the lock');
    let done;
    try { done = await within(w.done, 500, 'the job taken out of line while waiting for the lock'); } catch (e) { done = { outcome: `still waiting: ${firstLine(e)}` }; }
    if (done.outcome !== 'completed' || exact(done.returnvalue) !== exact({ skipped: true, jobId: K })) p.push(`a Stop while waiting for the lock: the job should complete with { skipped: true, jobId } at the next poll (${adr('D9')}); it ${show({ outcome: done.outcome, returnvalue: done.returnvalue })}`);
    if (!sem.calls[0] || sem.calls[0].outcome !== 'abandoned') p.push(`a Stop while waiting for the lock: the semaphore should be abandoned through shouldAbandon; its call ended ${show(sem.calls[0] && sem.calls[0].outcome)}`);
    if (proc.calls.length) p.push('a Stop while waiting for the lock: the processor ran');
    if (world.queue.has(K)) p.push('a Stop while waiting for the lock: the completed on-demand job should be removed');
    sem.free = true;
  });
  await withWorld({}, async (world) => {
    const ctl = newController(world);
    const sem = H.makeScriptedSemaphore({ free: true });
    const proc = H.makeFakeProcessor(world);
    const K = H.lineUpKey(122);
    await addJob(world, K);
    const w = world.queue.work(cb(ctl, sem, proc));
    await H.waitFor(() => proc.running(K), { what: 'the pass to start under its job id' });
    proc.end(K);
    const done = await within(w.done, 2000, 'the pass that runs');
    if (done.outcome !== 'completed' || proc.calls.length !== 1 || sem.releases !== 1) p.push(`a pass that runs: the job should complete after processJob ran once and the lease was released once; ${show({ outcome: done.outcome, processJob: proc.calls.length, releases: sem.releases })}`);
    const left = await itemsNow(ctl, world);
    if (left.length) p.push(`a pass that runs: nothing is busy once it has ended; the snapshot lists ${show(left)}`);
  });
  await withWorld({ record: { record: ownerStartRecord(H.lineUpKey(123)) } }, async (world) => {
    const ctl = newController(world);
    const sem = H.makeScriptedSemaphore({ free: false, acquireTimeoutMs: 60 });
    const proc = H.makeFakeProcessor(world);
    const K = H.lineUpKey(123);
    await addJob(world, K);
    const w = world.queue.work(cb(ctl, sem, proc));
    const done = await within(w.done, 2000, 'the job that gives up');
    if (done.outcome !== 'failed' || !done.error || done.error.code !== WAIT_CODE) p.push(`a give-up: the job should fail with ${WAIT_CODE}; it ${show({ outcome: done.outcome, error: done.error && done.error.code })}`);
    const entry = (parsed(world).passes || {})[K];
    if (!entry || entry.gaveUpAt !== iso(world.clock.now())) p.push(`a give-up: the record should hold gaveUpAt ${iso(world.clock.now())}; the entry is ${show(entry)}`);
    if (proc.calls.length) p.push('a give-up: the processor ran');
    if (world.queue.has(K)) p.push('a give-up: the failed on-demand job should be removed');
  });
  report(p);
});

// ─── runner ────────────────────────────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n--- task-queue job gate tests (epic tagging-edges, Story 6 — ADR 0006 D1–D5, D9, D11) ---');
  let pass = 0;
  let fail = 0;
  const failures = [];
  const dir = H.makeTempStateDir('job-gate');
  const restoreEnv = dir.useAsEnv();
  const restoreLogging = H.structuredLoggingOff();
  const killGuard = H.guardProcessKill({ label: 'the JG suite' });
  const strays = [];
  const onUnhandled = (reason) => { strays.push(`unhandled rejection: ${firstLine(reason)}`); };
  process.on('unhandledRejection', onUnhandled);
  try {
    for (const [name, fn] of tests) {
      strays.length = 0;
      const killsBefore = killGuard.directKills.length;
      let err = null;
      try { await fn(); } catch (e) { err = e; }
      await new Promise((r) => { setImmediate(r); });
      if (!err && strays.length) err = new Error(`the test left ${strays.length} unhandled rejection(s): ${strays.join('; ')}`);
      if (!err && killGuard.directKills.length > killsBefore) {
        err = new Error(`the code under test called process.kill directly (${show(killGuard.directKills.slice(killsBefore))}); a signal goes only through the injected kill(pid, signal) dep (${adr('D9')}; § Seams deps list)`);
      }
      if (err) {
        console.log(`  FAIL  ${name}\n        ${err.message}`);
        failures.push({ name, message: err.message });
        fail++;
      } else {
        console.log(`  PASS  ${name}`);
        pass++;
      }
    }
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    killGuard.restore();
    restoreLogging();
    restoreEnv();
    H.forgetModules([MODULES.controller, MODULES.gate, MODULES.store, MODULES.jobGates]);
    const left = fs.existsSync(dir.dir) ? fs.readdirSync(dir.dir) : [];
    dir.cleanup();
    if (left.length) {
      console.log(`  FAIL  the run wrote ${show(left)} under its TAGGING_EDGES_STATE_DIR; every record goes through the injected deps`);
      failures.push({ name: 'state directory', message: `wrote ${show(left)}` });
      fail++;
    }
  }
  console.log(`\ntask-queue-job-gate: ${pass} passed, ${fail} failed, 0 skipped`);
  return { pass, fail, skipped: 0, failures };
}

if (require.main === module) {
  run().then(({ fail }) => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
