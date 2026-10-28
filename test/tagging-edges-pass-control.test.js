'use strict';
/**
 * Tests for Story 6 (epic tagging-edges) — the pass's controller: lining a pass up, stopping one, what is busy, and
 * the private record of who did each.
 *
 * Story: engineering-team/stories/tagging-edges/6-pass-run-and-stop.md — AC-1 (Run: nothing busy, busy, just after a
 *        pass ends, the queue unavailable), AC-2 (waiting and stopping, the same for every viewer; the server unable
 *        to tell; a waiting pass that gives up), AC-3 (Stop: what it acts on, the out-of-date prompt, a waiting and a
 *        running pass, too late, nothing to stop, the schedule), AC-4 (either may act on the other's pass), AC-5 (who
 *        did it: every kind of who, only what happened, an action that cannot be recorded, the last 10), AC-6
 *        (nothing else moves), and the Test tasks "Server cases for AC-1 … AC-5" at the controller's level.
 * ADR:   engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md — D1 (one instance, the chain, bounded
 *        Redis, refusals outside the chain), D2 (an id per start, the job key, the id's millis), D5 (the busy
 *        snapshot), D6 (Run), D8 (the confirm route's start), D9 (Stop), D11 (the record), D12 (the status's
 *        `control` member), D14 (codes), and § Seams for Test Design (the deps list, the fakes, the load-time pins,
 *        "New cases the review named").
 *
 * Intentionally failing until the implementation lands (red phase): src/pipeline/tagging-edges/control/ does not
 * exist yet. Every module under test is loaded lazily inside each test through the shared loader
 * (test/helpers/taggingEdgesPassFakes.js loadModule), which names the missing module and the ADR decision, so this
 * suite always loads and every test fails on its own.
 *
 * Classes (all CT):
 *   CT1–CT3    the module and its instances (D1): exports, load-time side effects (in a child process), state per
 *              instance.
 *   CT4–CT6    the chain (D1): one step at a time, a failed step keeps the chain, a Run that cannot reach the queue
 *              neither breaks it nor adds (refused at once or at its own step).
 *   CT7–CT10   ids and keys (D2): the add, one id per start (CT8b: the controller's own ids), the legacy key, the id's
 *              millis.
 *   CT11–CT24  the busy snapshot (D5): read order and bounds, queue states, liveness and its key rules, every
 *              classification branch, stopAskedAt, sort order, moves between reads, the status-only cache.
 *   CT25–CT30  Run (D6): the record first, busy, record unavailable, a failed add, the finishing window, the queue
 *              unavailable.
 *   CT31–CT34  the confirm route's start (D8).
 *   CT35–CT50  Stop (D9): waiting, scheduled, running, out-of-date prompts, nothing to stop, the pid wait and its early
 *              ends, the signal check, a legacy id, `run:` targets, a restart, the queue down, unrecordable, either
 *              role.
 *   CT51–CT57  the record (D11): shape, history, pruning, a read error (CT55b: a schedule's start that cannot be
 *              recorded), a damaged file, the real store on a temp dir.
 *   CT58–CT62  the public status's `control` member (D12), through the real handleStatus with the controller's
 *              snapshot injected (CT58b: the four kinds of who, and two stoppers, indistinguishable).
 *   CT63–CT64  AC-6 and AC-3's schedule: Run and Stop change no schedule entry and not the real-time path's switch; a
 *              Stop never applies to the backstop's next run, not yet due.
 *
 * Hermetic: the controller is always an instance built by createController(deps) over the shared fakes (makeWorld:
 * a BullMQ-faithful fake queue, an in-memory record, a fake process table, a fake clock). TAGGING_EDGES_STATE_DIR
 * points at a temp directory for the whole run, so /var/lib/brainstorm is never read or written, and so does
 * SCHEDULED_TASKS_CONFIG_PATH (a temp file, set and the Scheduled Tasks module dropped from require's cache before the
 * first test, both put back after the last). process.kill is replaced for the whole run by the helper's
 * guardProcessKill, which signals nothing and fails the test that calls it: a signal must go through the injected
 * kill(pid, signal) dep, and the fake pids could name real host processes. No Redis, network, graph, relay or host
 * /proc. BRAINSTORM_STRUCTURED_LOGGING is false for the run.
 *
 * Choices this suite makes where the ADR leaves a detail open (recorded in the Test Design return):
 *   - Answers. lineUp and stop may resolve `{ status, body }` or a flat body (with or without `status`); the status
 *     is checked only when one is given, the code and members always. The confirm mode's answer is read as
 *     `enqueued` (or `linedUp`), `jobId` (or `key`) and `joined`.
 *   - snapshot is called as `snapshot({ ...deps, fresh }, { fresh })`, which serves both `snapshot(d, { fresh })` and
 *     `snapshot({ fresh })`; its items are read from `items` (or `busy`). Its times are compared as instants (epoch
 *     ms or ISO); ISO strings are pinned only on the status's `control` member (D12: "converted by the server").
 *   - who is handed to lineUp and stop already shortened, `{ kind, key: <8 hex> }` (or `{ kind }`), and is expected in
 *     the record as given.
 *   - randomKey() returns the whole job id (LINEUP_ID-shaped), not its hex: the controller adds under exactly what it
 *     answers. With randomKey left out, the controller makes its own ids, of the same form (CT8b).
 *   - The add's `timeoutMs` is checked only as a positive number: the deps list carries no time-out dep.
 *   - An add that times out answers 503 QUEUE_UNAVAILABLE (D14 "503 means the queue is unavailable"; R1); one that
 *     rejects may answer 503 or 500 { code: 'error', cause }.
 *   - The task-queue flag, and D1's "the queue's being off [is] answered before joining", are the handlers' checks
 *     (D6: "everything that calls a dep (the queue checks included) runs inside the handler's try/catch"; pinned by
 *     PX6 and PX6b). At lineUp, a Run with Redis not ready may be refused at once or when its own step runs (CT6, CT30).
 *   - D12 is checked through the real handleStatus with `snapshot` injected (index.js's defaultDeps gains `snapshot`,
 *     D8); the route's own report and confirmation reads go through an injected readFile.
 *   - CT57 omits readRecord, writeRecord and renameRecord from the deps and expects createController to fall back to
 *     its store under deps.stateDir(), as realtime.js's withDeps falls back to its store.
 *   - D12's member sets are closed: control carries only queue, busy and gaveUp, and a busy item (in the status or a
 *     409's busy list) only key, jobId, state, since, behind, runId, stopAskedAt, startRecorded and confirmation. A who
 *     under any other name is a member outside the set (CT26, CT58).
 *   - "Indistinguishable" (§ Constraints) is read on the control member, with key, jobId, since and runId set aside:
 *     those differ between any two passes whoever started them (CT58b).
 *   - AC-6 is checked over the fake queue's whole surface (remove and the job-scheduler calls in reach, not only the
 *     deps list's four methods), the Scheduled Tasks entries file, and realtime/switch.json and switch-history.json
 *     under both the run's TAGGING_EDGES_STATE_DIR and the world's deps.stateDir(), byte for byte (CT63; CT36 for the
 *     queue).
 *   - A gave-up wait shows when there is no report at all (no pass has started since it gave up).
 *   - Each stop target's key appears on a `stop` history line; how many lines one Stop writes is not pinned.
 *   - Pruning (D11): an entry that is neither busy, named by the history, nor joined to a run in report.json, and has
 *     no skip or noRerun, is dropped; so is a skip or noRerun entry whose job the last successful queue read did not
 *     find.
 *   - Deadlines run on real timers with the injected durations (FAST_TIMERS); a test that must outlast one also moves
 *     the fake clock, so a deadline measured with now() is met too. A test that waits a window out sets its own short
 *     value (CT19 endedKeysMs 200, CT43 pidWaitMs 300); a test that needs a long one sets that (CT6, CT13, CT24).
 *   - A status read is cached only when nothing bumped the generation: every D12 test changes state through a
 *     controller or gate step between two status reads, never through the fakes alone.
 *
 * Hand-rolled in the project's existing test style — no new framework. Works on Node 16 and 22.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./helpers/taggingEdgesPassFakes');

const {
  REPO, OWNER, ADMIN, OWNER_KEY, ADMIN_KEY, TASK, LEGACY_ID, LINEUP_ID, MODULES, PATHS, T0, adr,
} = H;

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const EVERY = 6 * HOUR;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WAIT_TIMEOUT = 'RESOURCE_CLASS_WAIT_TIMEOUT';
const SCHED_ENTRY = 'sched:seed:reconcileTaggingEdges';
const FOUR_READS = ['queue.getActive', 'queue.getDelayed', 'queue.getJobs', 'queue.getActive'];
const GATE_FNS = ['beforeAcquire', 'shouldAbandon', 'afterAcquire', 'ended', 'gaveUp', 'skipped'];
const ENTRY_FIELDS = ['jobId', 'start', 'stop', 'skip', 'noRerun', 'gaveUpAt'];
const WHO = Object.freeze({
  owner: Object.freeze({ kind: 'owner', key: OWNER_KEY }),
  admin: Object.freeze({ kind: 'admin', key: ADMIN_KEY }),
  local: Object.freeze({ kind: 'local' }),
  confirmation: Object.freeze({ kind: 'confirmation' }),
  schedule: Object.freeze({ kind: 'schedule' }),
  other: Object.freeze({ kind: 'other' }),
});

// ─── test harness ──────────────────────────────────────────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}
/** JSON with sorted keys; long strings shortened. */
function show(v) {
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return `<${v.code || 'Error'}: ${firstLine(v)}>`;
  try {
    const s = JSON.stringify(sortKeys(v), (k, x) => {
      if (typeof x === 'number' && !Number.isFinite(x)) return String(x);
      if (typeof x === 'string' && x.length > 160) return `${x.slice(0, 40)}…(${x.length} characters)`;
      return x;
    });
    return s && s.length > 900 ? `${s.slice(0, 900)}…` : s;
  } catch (_) {
    return String(v);
  }
}
/** Exact JSON with sorted keys (undefined members dropped, as on the wire). */
function exact(v) { return JSON.stringify(sortKeys(v)); }
const firstLine = (e) => String((e && e.message) || e).split('\n')[0];
const iso = (t) => new Date(t).toISOString();
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const pick = (o, keys) => (o && typeof o === 'object' ? keys.reduce((out, k) => { if (has(o, k)) out[k] = o[k]; return out; }, {}) : o);
/** An instant from epoch ms or an ISO string; NaN otherwise. */
const ms = (v) => (typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN);
const showTime = (v) => (v == null ? String(v) : Number.isFinite(ms(v)) ? iso(ms(v)) : show(v));
const isThenable = (v) => !!v && typeof v.then === 'function';

/** Run several cases; report every failing one, not only the first. */
async function cases(list, fn) {
  const failed = [];
  for (const c of list) {
    try { await fn(c); } catch (e) { failed.push(`[${c.name}] ${e.message}`); }
  }
  assert(failed.length === 0, `${failed.length} of ${list.length} case(s) failed:\n        ${failed.join('\n        ')}`);
}
/** Throw every problem at once. */
function report(problems, ref) {
  const p = problems.filter(Boolean);
  if (p.length) throw new Error(`${p.join('\n          ')}${ref ? ` (${adr(ref)})` : ''}`);
}
/** Settle `p` within `limit` ms, or throw naming `what`. */
async function within(p, limit, what) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(p),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not settle within ${limit} ms`)), limit); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function once(fn) { let done = false; return (...a) => { if (done) return undefined; done = true; return fn(...a); }; }
/** Move the fake clock with real time, so a deadline measured with now() also passes. */
function ticker(clock, every = 10) { const t = setInterval(() => clock.advance(every), every); return () => clearInterval(t); }

// ─── the run's environment (installed by run()) ────────────────────────────────────────────────────────────────
// process.kill is guarded by H.guardProcessKill({ label: 'the CT suite' }) for the whole run (see run()).
const SCHEDULED_TASKS_MODULE = 'src/api/scheduled-tasks/index.js';
/**
 * Point SCHEDULED_TASKS_CONFIG_PATH at `file` and drop the Scheduled Tasks module from require's cache, so anything
 * that requires it during the run reads and writes `file` (its CONFIG_PATH is fixed when it loads). → restore(): the
 * env and the cache entry as they were.
 */
function useScheduledTasksConfig(file) {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'SCHEDULED_TASKS_CONFIG_PATH');
  const was = process.env.SCHEDULED_TASKS_CONFIG_PATH;
  let abs = path.join(REPO, SCHEDULED_TASKS_MODULE);
  try { abs = require.resolve(abs); } catch (_) { /* not there: nothing cached */ }
  const cached = require.cache[abs];
  delete require.cache[abs];
  process.env.SCHEDULED_TASKS_CONFIG_PATH = file;
  return () => {
    if (cached) require.cache[abs] = cached; else delete require.cache[abs];
    if (had) process.env.SCHEDULED_TASKS_CONFIG_PATH = was; else delete process.env.SCHEDULED_TASKS_CONFIG_PATH;
  };
}

// ─── loading ───────────────────────────────────────────────────────────────────────────────────────────────────
function loadController(ref) {
  return H.loadModule(MODULES.controller, { createController: 'function' }, adr(ref));
}
function loadRoutes(ref) {
  return H.loadModule(MODULES.routes, { handleStatus: 'function' }, adr(ref));
}
function shapeProblems(ctl, label) {
  if (!ctl || typeof ctl !== 'object') return [`${label} should be an object { lineUp, stop, snapshot, gate } (${adr('D1')}); it is ${show(ctl)}`];
  const p = [];
  for (const k of ['lineUp', 'stop', 'snapshot']) if (typeof ctl[k] !== 'function') p.push(`${label}.${k} should be a function (${adr('D1')})`);
  const g = ctl.gate;
  if (!g || typeof g !== 'object') p.push(`${label}.gate should be { ${GATE_FNS.join(', ')} } (${adr('D1')}, D3); it is ${show(g)}`);
  else for (const k of GATE_FNS) if (typeof g[k] !== 'function') p.push(`${label}.gate.${k} should be a function (${adr('D1')}, D3)`);
  return p;
}

// ─── a controller over the fakes ───────────────────────────────────────────────────────────────────────────────
const WRAPPED = ['randomKey', 'readReport', 'readConfirmation', 'listClaimed', 'isAlive', 'readRecord', 'writeRecord', 'renameRecord', 'kill'];
const WRAPPED_QUEUE = ['getActive', 'getDelayed', 'getJobs', 'add'];

/**
 * world.deps with hook points a test sets after the controller is built: hooks.before[name](...args),
 * hooks.instead[name](...args) (replaces the call; not logged), hooks.after[name](result, ...args).
 */
function hookedDeps(world, hooks) {
  const wrap = (name, f) => function hooked(...args) {
    const b = hooks.before[name];
    if (b) b(...args);
    const i = hooks.instead[name];
    const out = i ? i(...args) : f.apply(this, args);
    const a = hooks.after[name];
    if (!a) return out;
    if (isThenable(out)) return out.then((v) => { a(v, ...args); return v; });
    a(out, ...args);
    return out;
  };
  const d = { ...world.deps };
  for (const n of WRAPPED) d[n] = wrap(n, world.deps[n]);
  d.queue = {};
  for (const n of WRAPPED_QUEUE) d.queue[n] = wrap(n, world.deps.queue[n]);
  return d;
}

function mk(ref, o = {}) {
  const { createController } = loadController(ref);
  const world = H.makeWorld(o.world || {});
  const hooks = { before: {}, instead: {}, after: {} };
  const deps = hookedDeps(world, hooks);
  for (const k of o.omit || []) delete deps[k];
  if (o.fullQueue) {
    // The fake queue's whole surface behind the four hooked methods, so a call outside the deps list (remove, a
    // job-scheduler call) reaches q.calls and the fake's state, where an AC-6 check can see it (CT36, CT63).
    const full = Object.create(world.queue);
    for (const n of WRAPPED_QUEUE) full[n] = deps.queue[n];
    deps.queue = full;
  }
  const ctl = createController(deps);
  report(shapeProblems(ctl, 'createController(deps)'));
  return { world, ctl, q: world.queue, deps, hooks, ref, createController };
}
/** A backend restart: a new instance over the same queue, report and record, with nothing in memory. */
function restart(ctx) {
  const ctl = ctx.createController(ctx.deps);
  report(shapeProblems(ctl, 'createController(deps)'));
  return ctl;
}
async function withCtl(ref, o, fn) {
  if (typeof o === 'function') { fn = o; o = {}; }
  const ctx = mk(ref, o);
  try {
    return await fn(ctx);
  } finally {
    try { ctx.q.releaseHangs(); } catch (_) { /* nothing hung */ }
    ctx.world.cleanup();
  }
}

// ─── calling it ────────────────────────────────────────────────────────────────────────────────────────────────
async function snap(ctx, { fresh = true, ctl = ctx.ctl, limit = 3000 } = {}) {
  const s = await within(ctl.snapshot({ ...ctx.deps, fresh }, { fresh }), limit, `snapshot({fresh: ${fresh}})`);
  assert(s && typeof s === 'object', `snapshot() should resolve an object { queue, items, … } (${adr('D5')}); it resolved ${show(s)}`);
  const items = Array.isArray(s.items) ? s.items : Array.isArray(s.busy) ? s.busy : null;
  assert(items, `snapshot() should carry its busy items as an array (${adr('D5')}: "Busy means items.length > 0"); it resolved ${show(s)}`);
  return { raw: s, queue: s.queue, items };
}
function answerOf(r, what) {
  assert(r && typeof r === 'object', `${what} should resolve an answer object; it resolved ${show(r)}`);
  if (Number.isInteger(r.status) && r.body && typeof r.body === 'object') return { status: r.status, body: r.body, what };
  return { status: Number.isInteger(r.status) ? r.status : undefined, body: r, what };
}
async function lineUp(ctx, who, mode = 'run', { ctl = ctx.ctl, limit = 3000 } = {}) {
  const what = `lineUp({who: ${who.kind}, mode: '${mode}'})`;
  return answerOf(await within(ctl.lineUp({ who, mode }), limit, what), what);
}
async function stop(ctx, who, targets, { ctl = ctx.ctl, limit = 3000 } = {}) {
  const what = `stop({who: ${who.kind}, targets: ${show(targets)}})`;
  return answerOf(await within(ctl.stop({ who, targets }), limit, what), what);
}
function codeProblems(a, code, status) {
  const p = [];
  if (a.body.code !== code) p.push(`${a.what} should answer code '${code}'; it answered ${show(a.body)}`);
  if (a.status !== undefined && a.status !== status) p.push(`${a.what} should answer status ${status}; it answered ${a.status}`);
  return p;
}
function expectCode(a, code, status, ref) { report(codeProblems(a, code, status), ref); }
/** A refusal of a Run whose add failed: 503 QUEUE_UNAVAILABLE, or 500 { code: 'error', cause } (D6 step 3). */
function addFailedProblems(a) {
  const ok503 = codeProblems(a, 'QUEUE_UNAVAILABLE', 503).length === 0;
  const ok500 = codeProblems(a, 'error', 500).length === 0;
  return ok503 || ok500 ? [] : [`${a.what} should answer 503 QUEUE_UNAVAILABLE or 500 { code: 'error', cause } when its add fails; it answered ${a.status} ${show(a.body)}`];
}
function expectLinedUp(a, ref) {
  const b = a.body;
  const p = [];
  if (a.status !== undefined && a.status !== 200) p.push(`status ${a.status}, not 200`);
  if (b.success !== true || b.linedUp !== true) p.push('no { success: true, linedUp: true }');
  if (typeof b.key !== 'string' || !LINEUP_ID.test(b.key)) p.push(`no key matching ${LINEUP_ID}`);
  if (b.recorded !== true) p.push('no recorded: true');
  if (p.length) throw new Error(`${a.what} should line up a pass and answer 200 { success: true, linedUp: true, key, recorded: true } (${adr(ref || 'D6')}): ${p.join('; ')}; it answered ${show(b)}`);
  return b.key;
}
const enqueuedOf = (a) => a.body.enqueued === true || (a.body.enqueued === undefined && a.body.linedUp === true);
const jobIdOfAnswer = (a) => (a.body.jobId !== undefined ? a.body.jobId : a.body.key);
function expectStopped(a, want, recorded, ref) {
  const b = a.body;
  const p = [];
  if (a.status !== undefined && a.status !== 200) p.push(`status ${a.status}, not 200`);
  if (b.success !== true) p.push('no success: true');
  const got = Array.isArray(b.stopped) ? b.stopped.map((s) => pick(s, ['key', 'how'])) : null;
  const byKey = (x, y) => String(x.key).localeCompare(String(y.key));
  if (!got || exact(got.slice().sort(byKey)) !== exact(want.slice().sort(byKey))) p.push(`stopped should be ${show(want)}; it is ${show(b.stopped)}`);
  if (recorded !== undefined && b.recorded !== recorded) p.push(`recorded should be ${recorded}; it is ${show(b.recorded)}`);
  if (p.length) throw new Error(`${a.what} should answer 200 { success: true, stopped: [{ key, how }], recorded } (${adr(ref || 'D9')}): ${p.join('; ')}; it answered ${show(b)}`);
}

// ─── the queue and the gate ────────────────────────────────────────────────────────────────────────────────────
/** A job added straight to the queue, as BullBoard or a pre-deploy stall would leave it (R3, R7). */
async function addJob(ctx, id, opts = {}) {
  await ctx.q.add(TASK, H.lineUpData(), { ...H.lineUpOpts(id), ...opts });
  return id;
}
function pick1(ctx, id) {
  const job = ctx.q.pickUp();
  assert(job && (id === undefined || job.id === id), `setup: ${id} should be picked up next; got ${show(job && job.id)} (queue ${show(ctx.q.dump())})`);
  return job;
}
async function gateCall(fnName, job, ctl, want) {
  const v = await within(ctl.gate[fnName](job), 3000, `gate.${fnName}(${job.id})`);
  if (want !== undefined) assert(v === want, `setup: gate.${fnName}(${job.id}) should answer '${want}' here (${adr('D3')}); it answered ${show(v)}`);
  return v;
}
/** Picked up, through beforeAcquire: waiting for the heavy-task lock. */
async function heavyWait(ctx, id, ctl = ctx.ctl) { const job = pick1(ctx, id); await gateCall('beforeAcquire', job, ctl, 'go'); return job; }
/** The lock won, through afterAcquire: starting (no record yet). */
async function launch(ctx, id, ctl = ctx.ctl) { const job = await heavyWait(ctx, id, ctl); await gateCall('afterAcquire', job, ctl, 'go'); return job; }
/** Launched, and its pass's first record written: running. */
async function runPass(ctx, id, p = {}, ctl = ctx.ctl) {
  const job = await launch(ctx, id, ctl);
  const rec = ctx.world.startPass({ jobId: String(job.id), ...p });
  return { job, rec };
}
/** A Run that lines up a pass; its key. */
async function runA(ctx, who = WHO.owner, ctl = ctx.ctl) { return expectLinedUp(await lineUp(ctx, who, 'run', { ctl }), 'D6'); }
const targetsOf = (items) => items.filter((i) => i.stopAskedAt == null).map((i) => ({ key: i.key, state: i.state }));

// ─── schedules and the real-time switch (AC-6) ─────────────────────────────────────────────────────────────────
/** A fake scheduler's entry as BullMQ keeps it, without its moving parts (the current slot and its offset). */
const entryTemplate = (s) => pick(s, ['id', 'name', 'data', 'opts', 'every']);
/** Every library call the fake queue saw that is neither a read (get…) nor an add, in order. */
const queueChanges = (ctx) => ctx.q.calls.map((x) => x.method).filter((m) => m !== 'add' && !/^get/.test(m));
/** A Scheduled Tasks entries file (version 2) with the pass's backstop enabled, as writeConfig writes it. */
function scheduledTasksText() {
  const entry = {
    id: 'seed:reconcileTaggingEdges', taskId: TASK, label: TASK, args: {}, enabled: true,
    intervalDays: 0, intervalHours: 6, intervalMinutes: 0, cron: '',
  };
  return JSON.stringify({ version: 2, entries: [entry] }, null, 2);
}
/** Write <dir>/realtime/switch.json (on, the owner's) and switch-history.json through the real-time store itself. */
function seedRealtimeSwitch(dir) {
  const { createStore } = H.loadModule('src/pipeline/tagging-edges/realtime/store.js', { createStore: 'function' }, 'ADR tagging-edges/0005 D1');
  const store = createStore({ dir: path.join(dir, 'realtime') });
  store.writeSwitch({ version: 2, on: true, changedAt: iso(T0 - HOUR), changedBy: OWNER_KEY, role: 'owner', onSince: iso(T0 - HOUR) });
  store.writeSwitchHistory({ version: 1, changes: [{ on: true, at: iso(T0 - HOUR), role: 'owner', key: OWNER_KEY }] });
  const sw = store.readSwitch();
  assert(sw && sw.on === true, `setup: the seeded switch under ${dir} should read on; it reads ${show(sw)}`);
}
/** Each file's text and each directory's sorted listing with its files' text (an error code when unreadable). */
function filesSnapshot(files, dirs) {
  const out = {};
  const text = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return `<${e.code || 'error'}>`; } };
  for (const f of files) out[f] = text(f);
  for (const d of dirs) {
    let names;
    try { names = fs.readdirSync(d).sort(); } catch (e) { out[`${d}${path.sep}`] = `<${e.code || 'error'}>`; continue; }
    out[`${d}${path.sep}`] = JSON.stringify(names);
    for (const n of names) out[path.join(d, n)] = text(path.join(d, n));
  }
  return out;
}
function filesProblems(before, after, label) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((k) => before[k] !== after[k]).map((k) => `${label}: ${k} changed — it was ${show(before[k])} and is now ${show(after[k])}`);
}

// ─── items ─────────────────────────────────────────────────────────────────────────────────────────────────────
const itemOf = (items, key) => items.find((i) => i && i.key === key);
function itemsProblems(items, wants, { ordered = false } = {}) {
  const p = [];
  const keys = items.map((i) => i && i.key);
  const wantKeys = wants.map((w) => w.key);
  const sameSet = keys.length === wantKeys.length && wantKeys.every((k) => keys.includes(k));
  if (!sameSet) p.push(`the busy items should be ${show(wantKeys)}; they are ${show(items)}`);
  else if (ordered && exact(keys) !== exact(wantKeys)) p.push(`the busy items should come in the order ${show(wantKeys)}; they come as ${show(keys)}`);
  for (const w of wants) {
    const it = itemOf(items, w.key);
    if (!it) continue;
    for (const [k, v] of Object.entries(w)) {
      if (k === 'key') continue;
      const got = it[k];
      if (k === 'since' || k === 'stopAskedAt') {
        if (v == null ? got != null : ms(got) !== ms(v)) p.push(`${w.key}: ${k} should be ${showTime(v)}; it is ${showTime(got)}`);
      } else if (v == null ? got != null : got !== v) {
        p.push(`${w.key}: ${k} should be ${show(v)}; it is ${show(got)}`);
      }
    }
  }
  return p;
}
function expectItems(items, wants, label, ref, opts) {
  const p = itemsProblems(items, wants, opts);
  if (p.length) throw new Error(`${label}: ${p.join('; ')} (${adr(ref)})`);
}

// ─── the record ────────────────────────────────────────────────────────────────────────────────────────────────
function recordOf(ctx) { try { return ctx.world.record.parsed(); } catch (_) { return { unparsable: ctx.world.record.bytes() }; } }
function entryOf(ctx, key) { const r = recordOf(ctx); return r && r.passes && typeof r.passes === 'object' ? r.passes[key] : undefined; }
function historyOf(ctx) { const r = recordOf(ctx); return r && Array.isArray(r.history) ? r.history : []; }
const count = (ctx, name) => ctx.world.callsOf(name).length;
const seqs = (ctx, name) => ctx.world.callsOf(name).map((c) => c.seq);
function entryProblems(ctx, key, want, label) {
  const e = entryOf(ctx, key);
  if (!e) return [`${label}: the record should hold an entry for ${key}; its passes are ${show(Object.keys((recordOf(ctx) || {}).passes || {}))}`];
  const got = pick(e, Object.keys(want));
  return exact(got) === exact(want) ? [] : [`${label}: the record's entry for ${key} should have ${show(want)}; it has ${show(got)}`];
}
function lineProblems(lines, want, label) {
  return lines.some((l) => exact(pick(l, ['action', 'key', 'at', 'who'])) === exact(want)) ? [] : [`${label}: the history should hold ${show(want)}; it is ${show(lines)}`];
}
/**
 * What a busy answer or the public control member must never carry: who (AC-2, AC-5; D6, D12). Used on a 409's body
 * and on control only, never on a whole status body (its confirmationPending names the owner's key, as it did before
 * story 6).
 */
function whoLeaks(v) {
  const s = JSON.stringify(v) || '';
  const needles = [['the owner\'s key', OWNER], ['an admin\'s key', ADMIN], ['the owner\'s short key', OWNER_KEY], ['an admin\'s short key', ADMIN_KEY], ['a "who" member', '"who"'], ['a "kind" member', '"kind"']];
  return needles.filter(([, n]) => s.includes(n)).map(([label]) => label);
}
/** D12's closed member sets: control's, and a busy item's (a who under any other name is a member outside them). */
const CONTROL_KEYS = ['queue', 'busy', 'gaveUp'];
const ITEM_KEYS = ['key', 'jobId', 'state', 'since', 'behind', 'runId', 'stopAskedAt', 'startRecorded', 'confirmation'];
function itemKeyProblems(items, label) {
  const p = [];
  for (const it of Array.isArray(items) ? items : []) {
    const extra = Object.keys(it && typeof it === 'object' ? it : {}).filter((k) => !ITEM_KEYS.includes(k));
    if (extra.length) p.push(`${label}: the busy item ${show(it && it.key)} carries members outside D12's set ${show(ITEM_KEYS)}: ${show(extra)}`);
  }
  return p;
}
function controlKeyProblems(control, label) {
  const extra = Object.keys(control && typeof control === 'object' ? control : {}).filter((k) => !CONTROL_KEYS.includes(k));
  return (extra.length ? [`${label}: control carries members outside D12's set ${show(CONTROL_KEYS)}: ${show(extra)}`] : [])
    .concat(itemKeyProblems(control && control.busy, label));
}
const SEED_KEY = H.lineUpKey(900);
/** An earlier owner's start, as a record from before this test would hold it. */
function seededRecord() {
  const at = iso(T0 - HOUR);
  return H.recordFile({
    passes: { [SEED_KEY]: H.recordEntry({ jobId: SEED_KEY, start: { at, who: { ...WHO.owner } } }) },
    history: [H.historyLine('start', SEED_KEY, at, { ...WHO.owner })],
  });
}

// ─── the public status, through the real handleStatus ──────────────────────────────────────────────────────────
function enoent(p) { return Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' }); }
function statusReadFile(world) {
  return async (p) => {
    const f = String(p);
    if (f.endsWith(`${path.sep}report.json`)) { if (world.report == null) throw enoent(f); return JSON.stringify(world.report); }
    if (f.endsWith(`${path.sep}confirmation.json`)) { if (world.confirmation == null) throw enoent(f); return JSON.stringify(world.confirmation); }
    throw enoent(f);
  };
}
async function statusOf(ctx, as = 'signed-out', ref = 'D12', ctl = ctx.ctl) {
  const { handleStatus } = loadRoutes(ref);
  const deps = { ...ctx.deps, readFile: statusReadFile(ctx.world), snapshot: (...a) => ctl.snapshot(...a) };
  const r = await H.callHandler(handleStatus, H.passReq(as, { method: 'GET', path: PATHS.status }), deps);
  assert(r.status === 200, `GET ${PATHS.status} should answer 200 (${adr('D12')}); it answered ${r.status} ${show(r.body)}`);
  const c = r.body && r.body.control;
  assert(c && typeof c === 'object' && Array.isArray(c.busy), `GET ${PATHS.status} should carry control: { queue, busy, gaveUp } (${adr(ref)}); its members are ${show(Object.keys(r.body || {}))}${c ? `, and control is ${show(c)}` : ''}`);
  return { body: r.body, control: c };
}
const busyItem = (control, key) => control.busy.find((i) => i && i.key === key);

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT1–CT3 — the module and its instances (D1)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT1: the controller module exports createController(deps) and `controller`, its one default instance; each instance is { lineUp, stop, snapshot, gate: { beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp, skipped } }, and createController builds a new one on every call [ADR 0006 D1 "One instance", "Tests build their own instance"; D3]', () => {
  const mod = H.loadModule(MODULES.controller, { createController: 'function', controller: 'object' }, adr('D1'));
  const world = H.makeWorld();
  try {
    const p = shapeProblems(mod.controller, 'the default controller');
    const a = mod.createController(world.deps);
    const b = mod.createController(world.deps);
    p.push(...shapeProblems(a, 'createController(deps)'));
    if (a === b || a === mod.controller) p.push(`createController(deps) should build a new instance on every call, apart from the default one (${adr('D1')})`);
    report(p);
  } finally {
    world.cleanup();
  }
});

test('CT2: loading the controller module does no disk or Redis work — it makes no <stateDir>/control/ directory, and requires no route module and not the queue module (checked in a child process); building an instance calls none of its deps (so it reads no record). Load-time record reads are pinned by SWR81\'s fs tracer (test/tagging-edges-wiring.test.js) [ADR 0006 D1 "Requires", "loaded lazily from disk on first use"; § Seams "Load-time pins"]', () => {
  const tmp = H.makeTempStateDir('ct2');
  try {
    const abs = path.join(REPO, MODULES.controller);
    const code = [
      "const path = require('path'); const fs = require('fs');",
      `const REPO = ${JSON.stringify(REPO)}; const ABS = ${JSON.stringify(abs)};`,
      'const before = new Set(Object.keys(require.cache));',
      'let err = null; let missing = false; let mod = null;',
      "try { mod = require(ABS); } catch (e) { err = String((e && e.message) || e).split('\\n')[0]; missing = !!(e && e.code === 'MODULE_NOT_FOUND' && err.includes(ABS)); }",
      'const added = Object.keys(require.cache).filter((k) => !before.has(k)).map((k) => path.relative(REPO, k));',
      'const entries = fs.readdirSync(process.env.TAGGING_EDGES_STATE_DIR);',
      "const hasController = !!(mod && mod.controller && typeof mod.controller === 'object');",
      "fs.writeSync(1, '\\n' + JSON.stringify({ err, missing, added, entries, hasController }) + '\\n');",
      'process.exit(0);',
    ].join('\n');
    const r = spawnSync(process.execPath, ['-e', code], {
      cwd: REPO, encoding: 'utf8', timeout: 30000,
      env: { ...process.env, TAGGING_EDGES_STATE_DIR: tmp.dir, BRAINSTORM_STRUCTURED_LOGGING: 'false' },
    });
    let out = null;
    try { out = JSON.parse(String(r.stdout || '').trim().split('\n').pop()); } catch (_) { out = null; }
    assert(out, `the load probe printed no result (exit ${r.status}, signal ${r.signal}): ${firstLine(r.stderr || '')}`);
    assert(!out.err, out.missing
      ? `${MODULES.controller} does not exist yet (${adr('D1')}): expected a module that loads with no disk or Redis work`
      : `${MODULES.controller} did not load (${adr('D1')}): ${out.err}`);
    const p = [];
    if (out.entries.length) p.push(`loading it made ${show(out.entries)} under the state directory; nothing is made or read before first use`);
    const routes = out.added.filter((f) => f.startsWith('src/api/'));
    if (routes.length) p.push(`it required route modules while loading: ${show(routes)} ("The controller requires no route module")`);
    if (out.added.includes(MODULES.queue)) p.push(`it required ${MODULES.queue} while loading ("It requires the queue module only lazily, through deps")`);
    if (!out.hasController) p.push('it exports no `controller` instance');
    const { createController } = loadController('D1');
    const world = H.makeWorld();
    try {
      let stateDirCalls = 0;
      createController({ ...world.deps, stateDir: () => { stateDirCalls += 1; return world.deps.stateDir(); } });
      const called = world.names().concat(stateDirCalls ? ['stateDir'] : []);
      if (called.length) p.push(`createController(deps) called ${show(called)} while building the instance`);
    } finally {
      world.cleanup();
    }
    report(p, 'D1');
  } finally {
    tmp.cleanup();
  }
});

test('CT3: each instance keeps its own marks — two controllers over one queue, each with its own record: a Stop through the first takes a waiting pass out of line in the first one\'s busy list only [ADR 0006 D1 "with the chain, all marks and the status cache on the instance"]', async () => {
  await withCtl('D1', async (ctx) => {
    const other = H.makeWorld({ clock: ctx.world.clock, queue: ctx.q });
    try {
      const b = { world: other, q: ctx.q, deps: other.deps, ctl: ctx.createController(other.deps) };
      const key = await runA(ctx);
      const st = await stop(ctx, WHO.admin, [{ key, state: 'waiting' }]);
      expectStopped(st, [{ key, how: 'taken-out-of-line' }], true, 'D9');
      expectItems((await snap(ctx)).items, [], 'the first instance, after its Stop', 'D1');
      expectItems((await snap(b)).items, [{ key, state: 'waiting' }], 'the second instance, which took no Stop', 'D1');
    } finally {
      other.cleanup();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT4–CT6 — the chain (D1)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT4: steps run one at a time — two Runs at once line up exactly one pass; the other is refused pass-busy naming that pass, nothing joins, and before the first step\'s add only that step\'s four reads ran [ADR 0006 D1 "The chain"; D6 step 1; AC-1 "When a pass is busy … Nothing new is lined up"]', async () => {
  await withCtl('D1', async (ctx) => {
    const answers = await Promise.all([lineUp(ctx, WHO.owner), lineUp(ctx, WHO.admin)]);
    const lined = answers.filter((x) => x.body.linedUp === true);
    const busy = answers.filter((x) => x.body.code === 'pass-busy');
    const p = [];
    if (lined.length !== 1 || busy.length !== 1) p.push(`one Run should line up and the other be refused pass-busy; they answered ${show(answers.map((x) => x.body))}`);
    if (count(ctx, 'queue.add') !== 1) p.push(`there should be exactly one add; there were ${count(ctx, 'queue.add')}`);
    if (ctx.q.joins.length) p.push(`a start joined an existing job: ${show(ctx.q.joins)}`);
    if (lined.length === 1 && busy.length === 1 && !(Array.isArray(busy[0].body.busy) && busy[0].body.busy.some((i) => i && i.key === lined[0].body.key))) {
      p.push(`the refusal's busy list should name ${lined[0].body.key}; it is ${show(busy[0].body.busy)}`);
    }
    const addSeq = seqs(ctx, 'queue.add')[0];
    const readsBefore = ctx.world.calls.filter((c) => c.name.startsWith('queue.get') && c.seq < addSeq).map((c) => c.name);
    if (addSeq !== undefined && exact(readsBefore) !== exact(FOUR_READS)) p.push(`before the first add only the first step's four reads may run; the reads were ${show(readsBefore)}`);
    report(p, 'D1');
  });
});

test('CT5: a step that fails never breaks the chain — a Run whose add is refused answers its refusal, and a Run whose step throws (an unexpected error, which may reject or answer 500) is followed by a Run that still lines up a pass [ADR 0006 D1 "step = chain.then(fn); chain = step.catch(() => {})"; D6 step 3, "Every exported pass.js handler resolves and never rejects" (the handler catches)]', async () => {
  await withCtl('D1', async (ctx) => {
    ctx.q.inject('add', { error: 'ECONNRESET' });
    const [a, b] = await Promise.all([lineUp(ctx, WHO.owner), lineUp(ctx, WHO.admin)]);
    report(addFailedProblems(a), 'D6');
    expectLinedUp(b, 'D1');
  });
  await withCtl('D1', async (ctx) => {
    let thrown = false;
    ctx.hooks.instead.randomKey = (...a) => {
      if (!thrown) { thrown = true; throw Object.assign(new Error('unexpected (injected)'), { code: 'EWEIRD' }); }
      return ctx.world.deps.randomKey(...a);
    };
    const first = ctx.ctl.lineUp({ who: WHO.owner, mode: 'run' });
    const second = lineUp(ctx, WHO.admin);
    let firstOutcome;
    try { firstOutcome = await within(first, 3000, 'the Run whose step throws'); } catch (e) { firstOutcome = e; }
    const p = [];
    if (!thrown) p.push('setup: randomKey was never called');
    const firstBody = firstOutcome instanceof Error || !firstOutcome ? null : (firstOutcome.body || firstOutcome);
    if (firstBody && firstBody.linedUp === true) p.push(`the Run whose step threw should not be lined up; it answered ${show(firstBody)}`);
    try { expectLinedUp(await second, 'D1'); } catch (e) { p.push(`the Run behind the throwing step: ${firstLine(e)}`); }
    report(p, 'D1');
  });
});

test('CT6: a Run that cannot reach the queue neither breaks nor joins another step\'s add — while another Run\'s add hangs inside the chain, a Run with Redis not ready is refused 503 QUEUE_UNAVAILABLE, at once or when its own step runs (Redis still not ready then), adding and recording nothing; the held Run then lines up. The task-queue flag is the handlers\' check (PX6, PX6b) [ADR 0006 D1 "The chain", "Every Redis call inside a step is bounded. First check d.queueHealth()"; D6 step 1 "If queue !== \'ok\' → 503 QUEUE_UNAVAILABLE"; D6 "everything that calls a dep (the queue checks included) runs inside the handler\'s try/catch"]', async () => {
  await withCtl('D1', { world: { timers: { stepMs: 4000 } } }, async (ctx) => {
    ctx.q.inject('add', { hang: true });
    const held = lineUp(ctx, WHO.owner, 'run', { limit: 8000 });
    await H.waitFor(() => count(ctx, 'queue.add') === 1, { what: 'the first Run to reach its add' });
    const p = [];
    ctx.world.health = 'not-ready';
    const second = lineUp(ctx, WHO.admin, 'run', { limit: 8000 });
    // Refused at once (before joining) or only when its own step runs (inside the chain): either reads D1 and D6.
    // Give it a moment, then let the held add land so a step-time refusal can come; Redis stays not ready until the
    // second Run has answered.
    await Promise.race([second.then(() => {}, () => {}), H.sleep(300)]);
    ctx.q.releaseHangs();
    try {
      const a = await second;
      p.push(...codeProblems(a, 'QUEUE_UNAVAILABLE', 503).map((x) => `the Run with Redis not ready: ${x}`));
    } catch (e) {
      p.push(`the Run with Redis not ready: ${firstLine(e)}`);
    }
    ctx.world.health = 'ready';
    const first = await held;
    try { expectLinedUp(first, 'D6'); } catch (e) { p.push(`the held Run: ${firstLine(e)}`); }
    if (count(ctx, 'queue.add') !== 1) p.push(`only the held Run may add; there were ${count(ctx, 'queue.add')} adds`);
    const passes = Object.keys((recordOf(ctx) || {}).passes || {});
    if (passes.length !== 1) p.push(`only the held Run may be recorded; the record's passes are ${show(passes)}`);
    report(p, 'D1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT7–CT10 — ids and keys (D2)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT7: a Run adds one job named by the task, under a fresh id of the form reconcileTaggingEdges-<12 hex> that BullMQ\'s own rule accepts, with enqueueTask\'s data { taskName, customerArgs: null, queryParams: undefined, timeoutMs } and exactly the options { jobId, removeOnComplete: true, removeOnFail: true }; the answer\'s key is that id [ADR 0006 D2 "The id", "How it adds"; probe P1]', async () => {
  await withCtl('D2', async (ctx) => {
    const key = await runA(ctx);
    const adds = ctx.world.callsOf('queue.add');
    assert(adds.length === 1, `one add expected (${adr('D2')}); there were ${adds.length}`);
    const [name, data, opts] = adds[0].args;
    const p = [];
    if (name !== TASK) p.push(`the job name should be '${TASK}'; it is ${show(name)}`);
    const d = data || {};
    if (d.taskName !== TASK || d.customerArgs !== null || !(Number.isFinite(d.timeoutMs) && d.timeoutMs > 0)) p.push(`the data should be { taskName: '${TASK}', customerArgs: null, queryParams: undefined, timeoutMs }; it is ${show(data)}`);
    const extra = Object.keys(d).filter((k) => !['taskName', 'customerArgs', 'queryParams', 'timeoutMs'].includes(k));
    if (extra.length) p.push(`the data carries more than enqueueTask's shape: ${show(extra)} (who never goes into job data, § Constraints)`);
    if (exact(Object.keys(opts || {}).sort()) !== exact(['jobId', 'removeOnComplete', 'removeOnFail'])) p.push(`the options should be exactly { jobId, removeOnComplete, removeOnFail }; they are ${show(opts)}`);
    else if (opts.removeOnComplete !== true || opts.removeOnFail !== true) p.push(`removeOnComplete and removeOnFail should both be true; they are ${show(opts)}`);
    const id = opts && opts.jobId;
    if (typeof id !== 'string' || !LINEUP_ID.test(id)) p.push(`the jobId should match ${LINEUP_ID}; it is ${show(id)}`);
    else {
      const why = H.bullmqRejects(id);
      if (why) p.push(`BullMQ refuses ${id}: ${why}`);
      if (id !== key) p.push(`the answer's key (${key}) should be the job's id (${id})`);
      if (!ctx.q.has(id)) p.push(`no job ${id} is in the queue`);
    }
    report(p, 'D2');
  });
});

test('CT8: every start gets its own id and nothing ever joins — three Runs (owner, admin, local) with each pass ended in between, and a start from the confirm route, use four distinct ids of the LINEUP_ID form, and the queue records no join [ADR 0006 D2; § Context "silent joins"; AC-1 "It is never answered as lined up when no pass will run"]', async () => {
  await withCtl('D2', async (ctx) => {
    const keys = [];
    for (const who of [WHO.owner, WHO.admin, WHO.local]) {
      const key = await runA(ctx, who);
      keys.push(key);
      ctx.q.complete(pick1(ctx, key).id);
      ctx.world.clock.advance(SEC);
    }
    const c = await lineUp(ctx, WHO.confirmation, 'confirm');
    assert(enqueuedOf(c) && c.body.joined !== true, `the confirm route's start with nothing busy should line up a new job (${adr('D8')}); it answered ${show(c.body)}`);
    keys.push(jobIdOfAnswer(c));
    const p = [];
    if (new Set(keys).size !== 4 || !keys.every((k) => LINEUP_ID.test(String(k)))) p.push(`four distinct ids of the form ${LINEUP_ID} expected; they are ${show(keys)}`);
    if (ctx.q.joins.length) p.push(`a start joined an existing job: ${show(ctx.q.joins)}`);
    report(p, 'D2');
  });
});

test('CT8b: with no randomKey injected, the controller makes its own ids — a Run lines up under a key of the form reconcileTaggingEdges-<12 hex> that BullMQ\'s own rule accepts, the add\'s jobId the same, and a second Run after the first pass ended gets a different one (the injected randomKey stands for the whole id, not its 12 hex digits) [ADR 0006 D2 "The id … \'reconcileTaggingEdges-\' + randomBytes(6).toString(\'hex\')"; probe P1; § Seams deps list "randomKey"]', async () => {
  await withCtl('D2', { omit: ['randomKey'] }, async (ctx) => {
    const keys = [];
    const p = [];
    for (let i = 0; i < 2; i += 1) {
      const key = await runA(ctx, WHO.owner);
      keys.push(key);
      const add = ctx.world.callsOf('queue.add')[i];
      const id = add && add.args[2] ? add.args[2].jobId : undefined;
      if (id !== key) p.push(`Run ${i + 1}: the add's jobId (${show(id)}) should be the answer's key (${key})`);
      const why = typeof id === 'string' ? H.bullmqRejects(id) : 'there is no jobId';
      if (why) p.push(`Run ${i + 1}: BullMQ refuses ${show(id)}: ${why}`);
      ctx.q.complete(pick1(ctx, key).id);
      ctx.world.clock.advance(SEC);
    }
    if (keys[0] === keys[1]) p.push(`the two Runs should get distinct ids; both are ${keys[0]}`);
    if (ctx.world.keys.length) p.push(`setup: the world's randomKey was called (${show(ctx.world.keys)}), though it was left out of the deps`);
    report(p, 'D2');
  });
});

test('CT9: the legacy fixed id — a job reconcileTaggingEdges (a pre-deploy stall or a BullBoard add) is keyed reconcileTaggingEdges@<timestamp>, with jobId reconcileTaggingEdges, while it waits and while its pass runs [ADR 0006 D2 "The job key", R7; D5 "Liveness comes first" rule 1 "this keeps legacy keys working"]', async () => {
  await withCtl('D2', async (ctx) => {
    await addJob(ctx, LEGACY_ID);
    const key = `${LEGACY_ID}@${T0}`;
    expectItems((await snap(ctx)).items, [{ key, jobId: LEGACY_ID, state: 'waiting', since: T0 }], 'a waiting legacy job', 'D2');
    ctx.world.clock.advance(MIN);
    await runPass(ctx, LEGACY_ID);
    expectItems((await snap(ctx)).items, [{ key, jobId: LEGACY_ID, state: 'running', since: T0 + MIN }], 'a running legacy pass', 'D2');
  });
});

test('CT10: a scheduled run\'s "since" is the id\'s millis — the digits after the id\'s LAST colon — for the seed entry\'s id repeat:sched:seed:reconcileTaggingEdges:<millis> and a plain entry\'s, whether due in `delayed`, picked up with no phase, or waiting for the lock; never the job\'s timestamp [ADR 0006 D2 "The id\'s millis"; D5 "since is the id\'s millis for a scheduled job"; § Seams "The fixtures include the seed form"]', async () => {
  await withCtl('D2', async (ctx) => {
    const M1 = T0 - 5 * MIN;
    const M2 = T0 - 3 * MIN;
    const seed = ctx.q.plantScheduled({ millis: M1, every: EVERY });
    const plain = ctx.q.plantScheduled({ entryId: 'entry42', millis: M2, every: EVERY });
    expectItems((await snap(ctx)).items, [
      { key: seed, jobId: seed, state: 'waiting', since: M1, behind: null },
      { key: plain, jobId: plain, state: 'waiting', since: M2, behind: null },
    ], 'two due scheduled runs, in delayed', 'D2', { ordered: true });
    const job = pick1(ctx, seed);
    expectItems((await snap(ctx)).items, [
      { key: seed, state: 'waiting', since: M1, behind: null },
      { key: plain, state: 'waiting', since: M2, behind: 'pass' },
    ], 'the seed run picked up (no phase yet), the other promoted to wait behind it', 'D2', { ordered: true });
    await gateCall('beforeAcquire', job, ctx.ctl, 'go');
    expectItems((await snap(ctx)).items, [
      { key: seed, state: 'waiting', since: M1, behind: 'heavy-work' },
      { key: plain, state: 'waiting', since: M2, behind: 'pass' },
    ], 'the seed run waiting for the heavy-task lock', 'D2', { ordered: true });
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT11–CT24 — the busy snapshot (D5)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT11: a snapshot reads confirmation.json first, then report.json, then (Redis ready) exactly four queue reads in this order — getActive, getDelayed, getJobs([\'waiting\', \'paused\', \'prioritized\']), getActive — and only then listClaimed(runId) for the running pass [ADR 0006 D5 reads 0–4; D12 "Read order for this verdict"]', async () => {
  await withCtl('D5', async (ctx) => {
    const key = await runA(ctx);
    const { rec } = await runPass(ctx, key);
    ctx.world.resetCalls();
    await snap(ctx);
    const calls = ctx.world.calls;
    const first = (n) => { const c = calls.find((x) => x.name === n); return c ? c.seq : undefined; };
    const queue = calls.filter((c) => c.name.startsWith('queue.'));
    const p = [];
    if (exact(queue.map((c) => c.name)) !== exact(FOUR_READS)) p.push(`the queue reads should be ${show(FOUR_READS)}; they were ${show(queue.map((c) => c.name))}`);
    const jobs = queue.find((c) => c.name === 'queue.getJobs');
    if (jobs && exact((jobs.args[0] || []).slice().sort()) !== exact(['paused', 'prioritized', 'waiting'])) p.push(`getJobs should read ['waiting', 'paused', 'prioritized'] (getWaiting covers only wait and paused); it read ${show(jobs.args[0])}`);
    const rc = first('readConfirmation');
    const rr = first('readReport');
    const lc = calls.filter((c) => c.name === 'listClaimed');
    if (rc === undefined || rr === undefined || !(rc < rr)) p.push(`readConfirmation should come before readReport; the calls were ${show(calls.map((c) => c.name))}`);
    if (rr !== undefined && queue.length && !(rr < queue[0].seq)) p.push('readReport should come before the queue reads');
    if (lc.length !== 1 || lc[0].args[0] !== rec.runId) p.push(`listClaimed should be called once, with the running pass's runId ${rec.runId}; the calls were ${show(lc)}`);
    else if (queue.length && !(lc[0].seq > queue[queue.length - 1].seq)) p.push('listClaimed should come after the queue reads');
    report(p, 'D5');
  });
});

test('CT12: the first queue read that fails or times out ends the reads — the rest are not issued, queue is \'read-failed\', and only the live pass is listed (a waiting job is never read as nothing waiting): a rejected first getActive, a rejected getDelayed, a getJobs that hangs past the deadline, a second getActive that hangs [ADR 0006 D5 "The first failure ends the reads", "When queue !== \'ok\', only the liveness item is known"; D1 "never as nothing there"]', async () => {
  await cases([
    { name: 'the first getActive rejects', set: (ctx) => ctx.q.inject('getActive', { error: 'ECONNRESET' }), issued: FOUR_READS.slice(0, 1) },
    { name: 'getDelayed rejects', set: (ctx) => ctx.q.inject('getDelayed', { error: 'ECONNRESET' }), issued: FOUR_READS.slice(0, 2) },
    { name: 'getJobs hangs', set: (ctx) => ctx.q.inject('getJobs', { hang: true }), issued: FOUR_READS.slice(0, 3) },
    { name: 'the second getActive hangs', set: (ctx) => { ctx.hooks.after.getActive = once(() => ctx.q.inject('getActive', { hang: true })); }, issued: FOUR_READS },
  ], (c) => withCtl('D5', async (ctx) => {
    const key = await runA(ctx);
    await runPass(ctx, key);
    await addJob(ctx, H.lineUpKey(50));
    ctx.world.resetCalls();
    c.set(ctx);
    const s = await snap(ctx, { limit: 3000 });
    const issued = ctx.world.calls.filter((x) => x.name.startsWith('queue.')).map((x) => x.name);
    const p = [];
    if (s.queue !== 'read-failed') p.push(`queue should be 'read-failed'; it is ${show(s.queue)}`);
    if (exact(issued) !== exact(c.issued)) p.push(`the reads issued should be ${show(c.issued)}; they were ${show(issued)}`);
    p.push(...itemsProblems(s.items, [{ key, state: 'running' }]));
    report(p, 'D5');
  }));
});

test('CT13: the snapshot\'s reads share ONE deadline (stepMs), each read getting what is left of it — under a 1000 ms deadline four 40 ms reads read \'ok\'; reads of 400 ms each, every one alone under it, end \'read-failed\' at the third; each read also moves the fake clock by its length, so a deadline measured with now() is met as well as one measured in real time [ADR 0006 D1 "The snapshot\'s reads share one deadline, REDIS_STEP_MS = 2000, and each read gets what is left of it"]', async () => {
  await withCtl('D1', { world: { timers: { stepMs: 1000 } } }, async (ctx) => {
    const slow = (n, delay) => (...a) => H.sleep(delay).then(() => { ctx.world.clock.advance(delay); return ctx.q[n](...a); });
    for (const n of ['getActive', 'getDelayed', 'getJobs']) ctx.hooks.instead[n] = slow(n, 40);
    const fast = await snap(ctx);
    for (const n of ['getActive', 'getDelayed', 'getJobs']) ctx.hooks.instead[n] = slow(n, 400);
    const slowS = await snap(ctx, { limit: 3000 });
    report([
      fast.queue !== 'ok' && `four 40 ms reads under a 1000 ms deadline should read 'ok'; queue is ${show(fast.queue)}`,
      slowS.queue !== 'read-failed' && `400 ms reads should run out of one shared 1000 ms deadline at the third read ('read-failed'); queue is ${show(slowS.queue)}`,
    ], 'D1');
  });
});

test('CT14: queue is \'off\' when the queue was never initialised, \'not-ready\' while Redis is not ready — in both, no queue read is issued and the live pass is still listed under its job id — and \'ok\' after four good reads [ADR 0006 D5 "`queue` is \'ok\', \'off\' …, \'not-ready\', or \'read-failed\'"; D2 queueHealth; D1 "First check d.queueHealth(), which issues no command"]', async () => {
  await cases([
    { name: 'off', health: 'off', want: 'off', reads: 0 },
    { name: 'not ready', health: 'not-ready', want: 'not-ready', reads: 0 },
    { name: 'ready', health: 'ready', want: 'ok', reads: 4 },
  ], (c) => withCtl('D5', async (ctx) => {
    const key = await runA(ctx);
    await runPass(ctx, key);
    ctx.world.health = c.health;
    ctx.world.resetCalls();
    const s = await snap(ctx);
    const reads = ctx.world.calls.filter((x) => x.name.startsWith('queue.')).length;
    report([
      s.queue !== c.want && `queue should be '${c.want}'; it is ${show(s.queue)}`,
      reads !== c.reads && `${c.reads} queue reads expected; there were ${reads}`,
      ...itemsProblems(s.items, [{ key, jobId: key, state: 'running' }]),
    ], 'D5');
  }));
});

test('CT15: liveness comes first, and its key follows three rules — (1) the read active job with the report\'s job id, picked up no later than the run started; (2) else the report\'s job id when it fits D10\'s pattern, is not the legacy id and no read job carries it; (3) else run:<runId> — for a hand run, a report from before story 6, a legacy id with no job, an id outside the pattern, and an orphan whose own job is being run again (then listed apart, as waiting); the matched job is never listed twice [ADR 0006 D5 "Liveness comes first"]', async () => {
  const K = H.lineUpKey(11);
  await cases([
    { name: 'rule 1: its active job', setup: async (ctx) => { await addJob(ctx, K); pick1(ctx, K); ctx.world.clock.advance(SEC); return ctx.world.startPass({ jobId: K }); }, want: () => [{ key: K, jobId: K, state: 'running' }] },
    { name: 'rule 2: its job is gone from the queue', setup: async (ctx) => { await addJob(ctx, K); ctx.q.complete(pick1(ctx, K).id); return ctx.world.startPass({ jobId: K }); }, want: () => [{ key: K, jobId: K, state: 'running' }] },
    { name: 'rule 3: a hand run (job null)', setup: async (ctx) => ctx.world.startPass({ jobId: null }), want: (r) => [{ key: `run:${r.runId}`, jobId: null, state: 'running', runId: r.runId }] },
    { name: 'rule 3: a report from before story 6 (no job member)', setup: async (ctx) => ctx.world.startPass({ preStory6: true }), want: (r) => [{ key: `run:${r.runId}`, jobId: null, state: 'running' }] },
    { name: 'rule 3: the legacy id with no job read', setup: async (ctx) => ctx.world.startPass({ jobId: LEGACY_ID }), want: (r) => [{ key: `run:${r.runId}`, jobId: LEGACY_ID, state: 'running' }] },
    { name: 'rule 3: a job id outside the pattern', setup: async (ctx) => ctx.world.startPass({ jobId: 'not a job id!' }), want: (r) => [{ key: `run:${r.runId}`, state: 'running' }] },
    {
      name: 'rule 3: an orphan whose own job is being run again',
      setup: async (ctx) => { const r = ctx.world.startPass({ jobId: K, startedAt: iso(T0 - 10 * MIN) }); await addJob(ctx, K); pick1(ctx, K); return r; },
      want: (r) => [{ key: `run:${r.runId}`, jobId: K, state: 'running', since: T0 - 10 * MIN }, { key: K, jobId: K, state: 'waiting', behind: null }],
      ordered: true,
    },
  ], (c) => withCtl('D5', async (ctx) => {
    const r = await c.setup(ctx);
    const s = await snap(ctx);
    expectItems(s.items, c.want(r), c.name, 'D5', { ordered: !!c.ordered });
    const live = s.items.find((i) => i.state === 'running');
    report([live && ms(live.since) !== Date.parse(r.startedAt) && `the running item's since should be the run's startedAt ${r.startedAt}; it is ${showTime(live.since)}`,
      live && live.runId !== r.runId && `the running item's runId should be ${r.runId}; it is ${show(live.runId)}`], 'D5');
  }));
});

test('CT16: a job in wait, paused or prioritized, or a delayed one whose time has come, is waiting — since its asked-for time (the id\'s millis for a scheduled run) and behind \'pass\' while another job of this queue is active or a pass is alive, else null; the backstop\'s next run, not yet due, is never listed, and a Run then lines up [ADR 0006 D5 "Due-delayed, wait, paused or prioritized"; story AC-2 "Waiting … The backstop\'s next scheduled run, whose time has not come, is never waiting"; AC-1]', async () => {
  const A = H.lineUpKey(21);
  const B = H.lineUpKey(22);
  await cases([
    { name: 'a job in wait, nothing active', setup: async (ctx) => { await addJob(ctx, A); return [{ key: A, state: 'waiting', since: T0, behind: null }]; } },
    {
      name: 'a job in wait behind one that is waiting for the lock',
      setup: async (ctx) => { await addJob(ctx, A); ctx.world.clock.advance(SEC); await addJob(ctx, B); await heavyWait(ctx, A); return [{ key: A, behind: 'heavy-work' }, { key: B, state: 'waiting', since: T0 + SEC, behind: 'pass' }]; },
    },
    { name: 'a paused queue', setup: async (ctx) => { ctx.q.pause(); await addJob(ctx, A); return [{ key: A, state: 'waiting', since: T0, behind: null }]; } },
    { name: 'a prioritized job', setup: async (ctx) => { await addJob(ctx, A, { priority: 2 }); return [{ key: A, state: 'waiting', since: T0, behind: null }]; } },
    {
      name: 'a due scheduled run while a pass runs',
      setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(2 * MIN); const s = ctx.q.plantScheduled({ millis: T0 + MIN, every: EVERY }); return [{ key: k, state: 'running' }, { key: s, state: 'waiting', since: T0 + MIN, behind: 'pass' }]; },
    },
    {
      name: 'a due scheduled run while a hand run is alive and no job is active',
      setup: async (ctx) => { const r = ctx.world.startPass({ jobId: null }); const s = ctx.q.plantScheduled({ millis: T0 - MIN, every: EVERY }); return [{ key: `run:${r.runId}`, state: 'running' }, { key: s, state: 'waiting', since: T0 - MIN, behind: 'pass' }]; },
    },
    {
      name: 'the backstop\'s next run, not yet due',
      setup: async (ctx) => { ctx.q.plantScheduled({ millis: T0 + HOUR, every: EVERY }); return []; },
      then: async (ctx) => { await runA(ctx); },
    },
  ], (c) => withCtl('D5', async (ctx) => {
    const want = await c.setup(ctx);
    expectItems((await snap(ctx)).items, want, c.name, 'D5');
    if (c.then) await c.then(ctx);
  }));
});

test('CT17: a pass picked up and waiting for the heavy-task lock (behind scoring) is waiting, behind \'heavy-work\', since the time it was asked for — not the time it was picked up [ADR 0006 D5 "Active, with phase waiting-for-lock → waiting, since as above, behind: \'heavy-work\'"; story AC-2 "what a waiting pass waits behind … other heavy database work"; AC-5 "Its time is when it was asked for"]', async () => {
  await withCtl('D5', async (ctx) => {
    const key = await runA(ctx);
    ctx.world.clock.advance(2 * MIN);
    await heavyWait(ctx, key);
    ctx.world.clock.advance(MIN);
    expectItems((await snap(ctx)).items, [{ key, jobId: key, state: 'waiting', since: T0, behind: 'heavy-work', runId: null, stopAskedAt: null }], 'a pass waiting behind scoring', 'D5');
  });
});

test('CT18: a launched job (lock won) is running and starting — since its launch, runId null — until its own run has ended, when it is ending (the finishing window) and not listed: its run is the report\'s latest with its job id and a startedAt no earlier than the launch, and has ended or is not alive; an earlier run of the same id does not end it; nor does a key in endedKeys stay listed [ADR 0006 D5 "Active, with phase launched"; § Context "The finishing window"; story "Busy … no moment in between"]', async () => {
  await cases([
    {
      name: 'launched, no report yet',
      run: async (ctx) => { const k = await runA(ctx); ctx.world.clock.advance(MIN); await launch(ctx, k); return [{ key: k, jobId: k, state: 'running', since: T0 + MIN, runId: null }]; },
    },
    {
      name: 'launched, the latest report is another job\'s finished run',
      run: async (ctx) => { ctx.world.startPass({ jobId: H.lineUpKey(99), startedAt: iso(T0 - HOUR) }); ctx.world.endPass({ state: 'done', endedAt: iso(T0 - HOUR + 3 * SEC) }); const k = await runA(ctx); await launch(ctx, k); return [{ key: k, state: 'running', since: T0, runId: null }]; },
    },
    {
      name: 'launched, the latest report is an EARLIER run of the same legacy id',
      run: async (ctx) => { ctx.world.startPass({ jobId: LEGACY_ID, startedAt: iso(T0 - HOUR) }); ctx.world.endPass({ state: 'done', endedAt: iso(T0 - HOUR + 3 * SEC) }); await addJob(ctx, LEGACY_ID); ctx.world.clock.advance(MIN); await launch(ctx, LEGACY_ID); return [{ key: `${LEGACY_ID}@${T0}`, jobId: LEGACY_ID, state: 'running', since: T0 + MIN, runId: null }]; },
    },
    {
      name: 'its run ended done (the job still active)',
      run: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(3 * SEC); ctx.world.endPass({ state: 'done' }); return []; },
    },
    {
      name: 'its run ended stopped',
      run: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(3 * SEC); ctx.world.endPass({ state: 'stopped' }); return []; },
    },
    {
      name: 'its run never ended but its process is gone (killed by the time-out)',
      run: async (ctx) => { const k = await runA(ctx); const { rec } = await runPass(ctx, k); ctx.world.procs.exit(rec.process.pid); return []; },
    },
    {
      name: 'its key is in endedKeys (the job not yet completed)',
      run: async (ctx) => { const k = await runA(ctx); const job = await launch(ctx, k); ctx.ctl.gate.ended(job); return []; },
    },
  ], (c) => withCtl('D5', async (ctx) => {
    const want = await c.run(ctx);
    expectItems((await snap(ctx)).items, want, c.name, 'D5');
  }));
});

test('CT19: an active job this process\'s gate has not seen (a pickup before beforeAcquire, or a stalled job after a restart) is waiting, behind null, since its asked-for time; once ended it is ending, and endedKeys forgets it after endedKeysMs (200 ms here), when it reads as waiting again [ADR 0006 D5 "Active with no phase"; D1 "endedKeys … entries dropped after 10 s"]', async () => {
  await withCtl('D5', { world: { timers: { endedKeysMs: 200 } } }, async (ctx) => {
    const key = await runA(ctx);
    ctx.world.clock.advance(MIN);
    const job = pick1(ctx, key);
    expectItems((await snap(ctx)).items, [{ key, state: 'waiting', since: T0, behind: null }], 'picked up, gate not yet called', 'D5');
    ctx.ctl.gate.ended(job);
    expectItems((await snap(ctx)).items, [], 'ended, the job still active', 'D5');
    ctx.world.clock.advance(ctx.deps.timers.endedKeysMs + 1);
    await H.sleep(ctx.deps.timers.endedKeysMs + 60);
    expectItems((await snap(ctx)).items, [{ key, state: 'waiting', behind: null }], `after endedKeysMs (${ctx.deps.timers.endedKeysMs} ms)`, 'D1');
  });
});

test('CT20: jobs taken out of line or never to be run again are dropped from the busy list, but the live pass is never hidden — a stopped waiting job, a record entry with skip (after a restart), a stalled re-run of a key with noRerun; while a stopped running pass stays listed as running with its stopAskedAt, in this process and after a restart [ADR 0006 D5 "Classifying the other jobs", "The live pass is never hidden by noRerun"; D9]', async () => {
  await cases([
    {
      name: 'a waiting job taken out of line',
      run: async (ctx) => { const k = await runA(ctx); expectStopped(await stop(ctx, WHO.owner, [{ key: k, state: 'waiting' }]), [{ key: k, how: 'taken-out-of-line' }], true); return { want: [] }; },
    },
    {
      name: 'a record entry with skip, read by a new instance',
      run: async (ctx) => { const k = await runA(ctx); await stop(ctx, WHO.owner, [{ key: k, state: 'waiting' }]); return { ctl: restart(ctx), want: [] }; },
    },
    {
      name: 'a running pass asked to stop',
      run: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(SEC); await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]); return { want: [{ key: k, state: 'running', stopAskedAt: T0 + SEC }] }; },
    },
    {
      name: 'the same, read by a new instance (noRerun and the stop from the record)',
      run: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(SEC); await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]); return { ctl: restart(ctx), want: [{ key: k, state: 'running', stopAskedAt: T0 + SEC }] }; },
    },
    {
      name: 'a stalled re-run of a stopped pass\'s job, after the pass ended',
      run: async (ctx) => {
        const k = await runA(ctx); await runPass(ctx, k); await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
        ctx.world.endPass({ state: 'stopped' }); ctx.q.stall(k);
        return { ctl: restart(ctx), want: [] };
      },
    },
  ], (c) => withCtl('D5', async (ctx) => {
    const { ctl, want } = await c.run(ctx);
    expectItems((await snap(ctx, { ctl: ctl || ctx.ctl })).items, want, c.name, 'D5');
  }));
});

test('CT21: stopAskedAt comes from the stop marks or the record under the item\'s key, and a running item falls back to a stop with the same runId — a legacy pass stopped as run:<runId> while Redis was down is listed under its job key once the queue answers, still with its stopAskedAt, and so after a restart from the record [ADR 0006 D5 "stopAskedAt … For a running item, it falls back to a stopsAsked value or a stop entry with the same runId"; D9 "A run: target"]', async () => {
  await withCtl('D5', async (ctx) => {
    await addJob(ctx, LEGACY_ID);
    const { rec } = await runPass(ctx, LEGACY_ID);
    ctx.world.health = 'not-ready';
    const runKey = `run:${rec.runId}`;
    expectItems((await snap(ctx)).items, [{ key: runKey, state: 'running' }], 'the legacy pass with Redis not ready', 'D5');
    ctx.world.clock.advance(SEC);
    const st = await stop(ctx, WHO.admin, [{ key: runKey, state: 'running' }]);
    expectStopped(st, [{ key: runKey, how: 'asked-to-stop' }], true, 'D9');
    ctx.world.health = 'ready';
    const legacyKey = `${LEGACY_ID}@${T0}`;
    expectItems((await snap(ctx)).items, [{ key: legacyKey, state: 'running', stopAskedAt: T0 + SEC }], 'the same pass, now matched to its job', 'D5');
    expectItems((await snap(ctx, { ctl: restart(ctx) })).items, [{ key: legacyKey, state: 'running', stopAskedAt: T0 + SEC }], 'after a restart, from the record', 'D5');
  });
});

test('CT22: busy items are sorted running first, then waiting by since — a running pass, then a due scheduled run asked for earliest, then two passes in the order they were asked for, whatever order they reached the queue [ADR 0006 D5 "Items are sorted running first, then waiting by since"]', async () => {
  await withCtl('D5', async (ctx) => {
    const k = await runA(ctx);
    await runPass(ctx, k);
    ctx.world.clock.advance(MIN);
    const b = await addJob(ctx, H.lineUpKey(31));
    ctx.world.clock.advance(MIN);
    const c = await addJob(ctx, H.lineUpKey(32));
    const s = ctx.q.plantScheduled({ millis: T0 - 10 * MIN, every: EVERY });
    expectItems((await snap(ctx)).items, [
      { key: k, state: 'running' }, { key: s, since: T0 - 10 * MIN }, { key: b, since: T0 + MIN }, { key: c, since: T0 + 2 * MIN },
    ], 'four busy passes', 'D5', { ordered: true });
  });
});

test('CT23: every move between reads is seen once, deduped by id with the later state kept, and a job that vanished mid-read is dropped — a due run picked up between the first getActive and getDelayed is still listed; a job stalled back to wait between reads is listed once, from its later state (behind null, not \'heavy-work\'); undefined entries break nothing [ADR 0006 D5 "Every move is seen at least once", "Missing jobs (undefined entries) are dropped"]', async () => {
  await cases([
    {
      name: 'delayed → wait → active between reads',
      run: async (ctx) => { const s = ctx.q.plantScheduled({ millis: T0 - MIN, every: EVERY }); ctx.hooks.before.getDelayed = once(() => { ctx.q.pickUp(); }); return [{ key: s, state: 'waiting', since: T0 - MIN }]; },
    },
    {
      name: 'a stall, active → wait, between reads',
      run: async (ctx) => { const k = await runA(ctx); await heavyWait(ctx, k); ctx.hooks.before.getDelayed = once(() => { ctx.q.stall(k); }); return [{ key: k, state: 'waiting', behind: null }]; },
    },
    {
      name: 'undefined entries in every read',
      run: async (ctx) => { const k = await runA(ctx); for (const n of ['getActive', 'getDelayed', 'getJobs']) ctx.q.inject(n, { undefinedEntries: 2, times: 2 }); return [{ key: k, state: 'waiting' }]; },
    },
  ], (c) => withCtl('D5', async (ctx) => {
    const want = await c.run(ctx);
    const s = await snap(ctx);
    report([s.queue !== 'ok' && `queue should be 'ok'; it is ${show(s.queue)}`, ...itemsProblems(s.items, want)], 'D5');
  }));
});

test('CT24: the 1 s snapshot cache is the status\'s only — after a Run a cached read shows the new pass; Run, Stop and the confirm route always read fresh (a job added behind the controller\'s back makes a Run refuse pass-busy, a Stop refuse prompt-out-of-date, and the confirm route join it, which also bumps the generation); an in-flight read from an older generation is neither served to a later reader nor stored [ADR 0006 D5 "Caching, for the status route only"; R3]', async () => {
  const p = [];
  await withCtl('D5', async (ctx) => {
    expectItems((await snap(ctx, { fresh: false })).items, [], 'the first cached read', 'D5');
    const k = await runA(ctx);
    p.push(...itemsProblems((await snap(ctx, { fresh: false })).items, [{ key: k }]).map((x) => `a cached read after a Run: ${x}`));
  });
  await withCtl('D5', async (ctx) => {
    expectItems((await snap(ctx, { fresh: false })).items, [], 'the first cached read', 'D5');
    await addJob(ctx, H.lineUpKey(41));
    p.push(...codeProblems(await lineUp(ctx, WHO.owner), 'pass-busy', 409).map((x) => `a Run after a BullBoard add: ${x}`));
  });
  await withCtl('D5', async (ctx) => {
    const k = await runA(ctx);
    expectItems((await snap(ctx, { fresh: false })).items, [{ key: k }], 'the cached read', 'D5');
    await addJob(ctx, H.lineUpKey(42));
    p.push(...codeProblems(await stop(ctx, WHO.owner, [{ key: k, state: 'waiting' }]), 'prompt-out-of-date', 409).map((x) => `a Stop after a BullBoard add: ${x}`));
  });
  await withCtl('D5', async (ctx) => {
    expectItems((await snap(ctx, { fresh: false })).items, [], 'the first cached read', 'D5');
    const b = await addJob(ctx, H.lineUpKey(43));
    const c = await lineUp(ctx, WHO.confirmation, 'confirm');
    if (!(enqueuedOf(c) && c.body.joined === true)) p.push(`the confirm route after a BullBoard add should join it ({ enqueued: true, joined: true }); it answered ${show(c.body)}`);
    p.push(...itemsProblems((await snap(ctx, { fresh: false })).items, [{ key: b }]).map((x) => `a cached read after the joined answer: ${x}`));
  });
  // The in-flight case: a 5 s step, so the held first read cannot time out on its own before the later reads are made.
  await withCtl('D5', { world: { timers: { stepMs: 5000 } } }, async (ctx) => {
    let release;
    const gate = new Promise((r) => { release = r; });
    let frozen = false;
    let n = 0;
    for (const name of ['getActive', 'getDelayed', 'getJobs']) {
      ctx.hooks.instead[name] = (...a) => {
        n += 1;
        if (n === 1) return gate.then(() => []);
        if (frozen) return Promise.resolve([]);
        return ctx.q[name](...a);
      };
    }
    let s1Settled = false;
    const s1 = snap(ctx, { fresh: false, limit: 5000 }).finally(() => { s1Settled = true; });
    await H.waitFor(() => n >= 1, { what: 'the first read of the in-flight snapshot' });
    let k;
    try {
      k = await runA(ctx);
    } catch (e) {
      release();
      await s1.catch(() => {});
      throw new Error(`a Run should not wait for an in-flight status read, which is not a chain step (${adr('D1')} "These join the chain"): ${firstLine(e)}`);
    }
    try {
      const s2 = await snap(ctx, { fresh: false, limit: 1500 });
      p.push(...itemsProblems(s2.items, [{ key: k }]).map((x) => `a read while an older read is in flight: ${x}`));
    } catch (e) {
      p.push(`a read while an older read is in flight waited on it: ${firstLine(e)}`);
    }
    if (s1Settled) p.push('setup: the older snapshot settled before its held read was released, so it was no longer in flight and this case tested nothing');
    frozen = true;
    release();
    await s1;
    frozen = false;
    p.push(...itemsProblems((await snap(ctx, { fresh: false })).items, [{ key: k }]).map((x) => `a read after the older in-flight read settled: ${x}`));
  });
  report(p, 'D5');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT25–CT32 — Run: lineUp({ who, mode: 'run' }) (D6)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT25: a Run with nothing busy takes a fresh snapshot, writes the record (the start and its history line, who and when), then adds, and answers 200 { success: true, linedUp: true, key, recorded: true } — for the owner, an admin (each with a shortened key) and a direct local call; the pass then shows waiting since the Run, and no answer carries a full pubkey [ADR 0006 D6 steps 1–4 "The record first"; D11; D14 "No answer carries a full pubkey"; story AC-1, AC-5 "What is recorded"]', async () => {
  await cases([
    { name: 'the owner', who: WHO.owner },
    { name: 'an admin', who: WHO.admin },
    { name: 'a direct local call', who: WHO.local },
  ], (c) => withCtl('D6', async (ctx) => {
    const a = await lineUp(ctx, c.who);
    const key = expectLinedUp(a, 'D6');
    const w = seqs(ctx, 'writeRecord');
    const ad = seqs(ctx, 'queue.add');
    const read = seqs(ctx, 'queue.getActive');
    const at = iso(T0);
    const p = [];
    if (w.length !== 1 || ad.length !== 1) p.push(`one record write and one add expected; there were ${w.length} and ${ad.length}`);
    else if (!(w[0] < ad[0])) p.push('the record must be written before the add ("The record first")');
    if (!read.length || (w.length && !(read[0] < w[0]))) p.push('the fresh snapshot must come before the record write (step 1, then step 2)');
    const r = recordOf(ctx);
    if (!r || r.version !== 1) p.push(`the record should be version 1; it is ${show(r)}`);
    p.push(...entryProblems(ctx, key, { jobId: key, start: { at, who: { ...c.who } }, stop: null, skip: false, noRerun: false, gaveUpAt: null }, 'the start'));
    const h = historyOf(ctx);
    if (!(h.length === 1 && exact(pick(h[0], ['action', 'key', 'at', 'who'])) === exact({ action: 'start', key, at, who: { ...c.who } }))) p.push(`the history should be [{ action: 'start', key, at, who }]; it is ${show(h)}`);
    p.push(...itemsProblems((await snap(ctx)).items, [{ key, jobId: key, state: 'waiting', since: T0, behind: null, runId: null, stopAskedAt: null }]));
    const bytes = JSON.stringify(a.body) + String(ctx.world.record.bytes());
    if (bytes.includes(OWNER) || bytes.includes(ADMIN)) p.push('a full pubkey appears in the answer or the record');
    report(p, 'D6');
  }));
});

test('CT26: a Run while a pass is busy is refused 409 { code: \'pass-busy\', busy } with the busy items (no member outside D12\'s item set) and no who, lining up and recording nothing — a first pass waiting with no report yet, one waiting behind scoring, one starting, one running, a due scheduled run waiting (the seed id form), a due scheduled run behind a running pass (both listed), and a running pass with a stop asked for, until it ends [ADR 0006 D6 step 1; D9 "A Run meanwhile is refused pass-busy"; story AC-1 "When a pass is busy", "When more than one pass is busy, the panel shows each"; § Seams "New cases the review named"]', async () => {
  await cases([
    { name: 'a first pass asked for and waiting, with no report yet', setup: async (ctx) => [await runA(ctx)] },
    { name: 'a pass waiting behind scoring', setup: async (ctx) => { const k = await runA(ctx); await heavyWait(ctx, k); return [k]; } },
    { name: 'a pass starting (lock won, no record yet)', setup: async (ctx) => { const k = await runA(ctx); await launch(ctx, k); return [k]; } },
    { name: 'a running pass', setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); return [k]; } },
    { name: 'a due scheduled run waiting', setup: async (ctx) => [ctx.q.plantScheduled({ millis: T0 - MIN, every: EVERY })] },
    {
      name: 'a due scheduled run waiting behind a running pass',
      setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); ctx.world.clock.advance(2 * MIN); return [k, ctx.q.plantScheduled({ millis: T0 + MIN, every: EVERY })]; },
    },
    {
      name: 'a running pass with a stop asked for',
      setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); expectStopped(await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]), [{ key: k, how: 'asked-to-stop' }], true); return [k]; },
    },
  ], (c) => withCtl('D6', async (ctx) => {
    const keys = await c.setup(ctx);
    const adds = count(ctx, 'queue.add');
    const writes = count(ctx, 'writeRecord');
    const bytes = ctx.world.record.bytes();
    const a = await lineUp(ctx, WHO.admin);
    const p = codeProblems(a, 'pass-busy', 409);
    const busy = Array.isArray(a.body.busy) ? a.body.busy : null;
    if (!busy) p.push(`the refusal should carry busy: the busy items; it is ${show(a.body)}`);
    else p.push(...itemsProblems(busy, keys.map((key) => ({ key }))));
    const leaks = whoLeaks(a.body);
    if (leaks.length) p.push(`the refusal carries who: ${leaks.join(', ')}`);
    p.push(...itemKeyProblems(busy, 'the refusal'));
    if (count(ctx, 'queue.add') !== adds || count(ctx, 'writeRecord') !== writes || ctx.world.record.bytes() !== bytes) p.push('a refused Run added or recorded something');
    report(p, 'D6');
  }));
});

test('CT27: a Run whose record cannot be written is refused 500 { code: \'record-unavailable\' } and adds nothing, the history before it surviving byte for byte — a record that gives a read error is not written at all; a write that fails with ENOSPC answers cause \'ENOSPC\', and one whose code names an address answers cause \'error\' [ADR 0006 D6 step 2; D11 "While it still gives a read error, nothing writes it"; D14 "Thrown codes go through allowErrorCode"; story AC-5 "When the server cannot record an action: a Run is refused and changes nothing", "the history recorded before it survives"]', async () => {
  await cases([
    { name: 'a read error', set: (ctx) => ctx.world.record.failReads('EIO'), writes: 0 },
    { name: 'a write that fails (ENOSPC)', set: (ctx) => ctx.world.record.failWrites('ENOSPC'), cause: 'ENOSPC' },
    { name: 'a write whose code names an address', set: (ctx) => ctx.world.record.failWrites('neo4j.internal:7687'), cause: 'error' },
  ], (c) => withCtl('D6', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const bytes = ctx.world.record.bytes();
    c.set(ctx);
    const a = await lineUp(ctx, WHO.owner);
    const p = codeProblems(a, 'record-unavailable', 500);
    if (c.cause !== undefined && a.body.cause !== c.cause) p.push(`cause should be '${c.cause}'; it is ${show(a.body.cause)}`);
    if (c.writes === 0 && count(ctx, 'writeRecord') !== 0) p.push(`a record that gives a read error must not be written; writeRecord was called ${count(ctx, 'writeRecord')} time(s)`);
    if (count(ctx, 'queue.add') !== 0 || ctx.q.jobs().length) p.push('nothing may be added');
    if (ctx.world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    if (JSON.stringify(a.body).includes('neo4j.internal')) p.push('the answer carries the raw code');
    report(p, 'D6');
  }));
});

test('CT28: a Run whose add fails or times out puts its key in skips (a late landing completes without spawning), removes its start entry and history line in one best-effort write — leaving no start in passes or history and the earlier record intact — and answers 503 QUEUE_UNAVAILABLE when the add timed out, 503 or 500 { code: \'error\' } when it was refused; a later Run lines up [ADR 0006 D6 step 3; D14 "503 means the queue is unavailable"; R1; § Seams "A Run whose add times out leaves no start in passes or history"]', async () => {
  await cases([
    { name: 'the add times out, then lands', fault: { hang: true }, lands: true, answer: (a) => codeProblems(a, 'QUEUE_UNAVAILABLE', 503) },
    { name: 'the add is refused', fault: { error: 'ECONNRESET' }, answer: addFailedProblems },
  ], (c) => withCtl('D6', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const before = recordOf(ctx);
    ctx.q.inject('add', c.fault);
    const a = await lineUp(ctx, WHO.owner);
    const key = ctx.world.callsOf('queue.add')[0].args[2].jobId;
    const addSeq = seqs(ctx, 'queue.add')[0];
    const p = c.answer(a);
    const after = recordOf(ctx);
    if (exact(pick(after, ['passes', 'history'])) !== exact(pick(before, ['passes', 'history']))) p.push(`the record should be as it was before the Run: ${show(pick(before, ['passes', 'history']))}; it is ${show(after)}`);
    const rollback = seqs(ctx, 'writeRecord').filter((s) => s > addSeq).length;
    if (rollback !== 1) p.push(`the start should be removed in one write after the add; there were ${rollback}`);
    if (ctx.ctl.gate.shouldAbandon({ id: key, timestamp: T0, data: H.lineUpData() }) !== true) p.push(`the key ${key} should be in skips (shouldAbandon true)`);
    if (c.lands) {
      ctx.q.releaseHangs();
      await H.waitFor(() => ctx.q.has(key), { what: 'the late add to land' });
      p.push(...itemsProblems((await snap(ctx)).items, []).map((x) => `after the late landing: ${x}`));
      const job = pick1(ctx, key);
      const v = await gateCall('beforeAcquire', job, ctx.ctl);
      if (v !== 'skip') p.push(`the late landing should be skipped at pickup; beforeAcquire answered ${show(v)}`);
      ctx.q.complete(job.id, ctx.ctl.gate.skipped(job));
    }
    try { await runA(ctx); } catch (e) { p.push(`a later Run: ${firstLine(e)}`); }
    report(p, 'D6');
  }));
});

test('CT29: a Run in the finishing window (the pass has exited, its job is still active) is not refused: it lines up a NEW job, which waits behind the ending one and is picked up once it completes, nothing joining — and so does the confirm route\'s start [ADR 0006 D6 "The finishing window", D8; story AC-1 "Just after a pass ends … never answered as lined up when no pass will run"; ledger 2026-09-28-confirm-route-joins-finishing-job]', async () => {
  await cases([
    { name: 'Run', mode: 'run', who: WHO.owner },
    { name: 'the confirm route', mode: 'confirm', who: WHO.confirmation },
  ], (c) => withCtl('D6', async (ctx) => {
    const k1 = await runA(ctx);
    const { job } = await runPass(ctx, k1);
    ctx.world.clock.advance(3 * SEC);
    ctx.world.endPass({ state: 'done' });
    expectItems((await snap(ctx)).items, [], 'the ending job', 'D5');
    const a = await lineUp(ctx, c.who, c.mode);
    const k2 = c.mode === 'run' ? expectLinedUp(a, 'D6') : jobIdOfAnswer(a);
    const p = [];
    if (c.mode === 'confirm' && !(enqueuedOf(a) && a.body.joined !== true)) p.push(`the confirm route should line up a new job ({ enqueued: true, jobId }); it answered ${show(a.body)}`);
    if (!(typeof k2 === 'string' && LINEUP_ID.test(k2) && k2 !== k1)) p.push(`a new id expected; it is ${show(k2)}`);
    if (ctx.q.joins.length) p.push(`the start joined the ending job: ${show(ctx.q.joins)}`);
    if (ctx.q.state(k2) !== 'waiting') p.push(`the new job should wait behind the ending one; it is ${ctx.q.state(k2)}`);
    ctx.ctl.gate.ended(job);
    ctx.q.complete(k1);
    const next = ctx.q.pickUp();
    if (!next || next.id !== k2) p.push(`the new job should be picked up next; got ${show(next && next.id)}`);
    report(p, 'D6');
  }));
});

test('CT30: a Run with the task queue unavailable is refused 503 { code: \'QUEUE_UNAVAILABLE\' }, adding and recording nothing — the queue never initialised, Redis not ready, and a fresh snapshot whose queue read fails (the task-queue flag is the handlers\' check: PX6 and PX6b, PX17 and PX35 for the run-task delegate) [ADR 0006 D6 "Off-queue refusal", step 1 "If queue !== \'ok\' → 503"; story AC-1 "When the task queue is unavailable"]', async () => {
  await cases([
    { name: 'the queue never initialised', set: (ctx) => { ctx.world.health = 'off'; } },
    { name: 'Redis not ready', set: (ctx) => { ctx.world.health = 'not-ready'; } },
    { name: 'a queue read fails', set: (ctx) => ctx.q.inject('getActive', { error: 'ECONNRESET' }) },
  ], (c) => withCtl('D6', async (ctx) => {
    c.set(ctx);
    const a = await lineUp(ctx, WHO.owner);
    report([...codeProblems(a, 'QUEUE_UNAVAILABLE', 503),
      count(ctx, 'queue.add') !== 0 && 'nothing may be added',
      count(ctx, 'writeRecord') !== 0 && 'nothing may be recorded'], 'D6');
  }));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT31–CT34 — the confirm route's start: lineUp({ who: { kind: 'confirmation' }, mode: 'confirm' }) (D8)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT31: the confirm route\'s start joins a busy pass that has no stop asked for, adding and recording nothing — { enqueued: true, joined: true } — for a pass waiting, one waiting behind scoring, one starting, and a running pass whose first record was written after the route\'s re-read (it takes the confirmation up at its claim) [ADR 0006 D8 "Busy with any item that has no stop asked for"; § Seams "The confirm route meets a pass whose record appeared after its re-read"]', async () => {
  await cases([
    { name: 'waiting', setup: async (ctx) => { await runA(ctx); } },
    { name: 'waiting behind scoring', setup: async (ctx) => { await heavyWait(ctx, await runA(ctx)); } },
    { name: 'starting', setup: async (ctx) => { await launch(ctx, await runA(ctx)); } },
    { name: 'running, its record written after the re-read', setup: async (ctx) => { await runPass(ctx, await runA(ctx), { through: 'identities' }); } },
  ], (c) => withCtl('D8', async (ctx) => {
    await c.setup(ctx);
    const adds = count(ctx, 'queue.add');
    const writes = count(ctx, 'writeRecord');
    const a = await lineUp(ctx, WHO.confirmation, 'confirm');
    report([!(enqueuedOf(a) && a.body.joined === true) && `the answer should be { enqueued: true, joined: true }; it is ${show(a.body)}`,
      count(ctx, 'queue.add') !== adds && 'nothing may be added',
      count(ctx, 'writeRecord') !== writes && 'nothing may be recorded',
      ctx.q.joins.length && `BullMQ joined: ${show(ctx.q.joins)}`], 'D8');
  }));
});

test('CT32: the confirm route\'s start lines up a new job, recording its start as the owner\'s confirmation, when nothing is busy or only passes with a stop asked are busy — { enqueued: true, jobId: <new id> }, not joined [ADR 0006 D8 "Busy only with passes that have a stop asked for, or not busy"; story AC-5 "the owner\'s confirmation, for a pass the confirm route started"]', async () => {
  await cases([
    { name: 'nothing busy', setup: async () => {} },
    { name: 'a running pass with a stop asked for', setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]); ctx.world.clock.advance(SEC); } },
  ], (c) => withCtl('D8', async (ctx) => {
    await c.setup(ctx);
    const at = iso(ctx.world.clock.now());
    const a = await lineUp(ctx, WHO.confirmation, 'confirm');
    const key = jobIdOfAnswer(a);
    const p = [];
    if (!(enqueuedOf(a) && a.body.joined !== true)) p.push(`the answer should be { enqueued: true, jobId } and not joined; it is ${show(a.body)}`);
    if (!(typeof key === 'string' && LINEUP_ID.test(key) && ctx.q.has(key))) p.push(`a new job of the form ${LINEUP_ID} should be in the queue; the answer's id is ${show(key)}`);
    else {
      p.push(...entryProblems(ctx, key, { jobId: key, start: { at, who: { ...WHO.confirmation } } }, 'the confirmation\'s start'));
      p.push(...lineProblems(historyOf(ctx), { action: 'start', key, at, who: { ...WHO.confirmation } }, 'the confirmation\'s start'));
    }
    report(p, 'D8');
  }));
});

test('CT33: the confirm route\'s start adds and records nothing and answers enqueued: false when the queue is not ready, never initialised, or its fresh read fails; and when its add fails it puts the key in skips and removes any start it wrote, answering enqueued: false — the confirmation stays pending [ADR 0006 D8 "Queue not ready …", "An add that fails or times out"]', async () => {
  await cases([
    { name: 'Redis not ready', set: (ctx) => { ctx.world.health = 'not-ready'; } },
    { name: 'the queue never initialised', set: (ctx) => { ctx.world.health = 'off'; } },
    { name: 'the fresh read fails', set: (ctx) => ctx.q.inject('getDelayed', { error: 'ECONNRESET' }) },
    { name: 'the add fails', set: (ctx) => ctx.q.inject('add', { error: 'ECONNRESET' }), addFails: true },
  ], (c) => withCtl('D8', async (ctx) => {
    c.set(ctx);
    const a = await lineUp(ctx, WHO.confirmation, 'confirm');
    const p = [];
    if (enqueuedOf(a)) p.push(`the answer should say enqueued: false; it is ${show(a.body)}`);
    if (c.addFails) {
      const key = ctx.world.callsOf('queue.add')[0].args[2].jobId;
      if (entryOf(ctx, key) && entryOf(ctx, key).start) p.push(`the start for ${key} should be removed; the record is ${show(recordOf(ctx))}`);
      if (historyOf(ctx).some((l) => l.key === key)) p.push(`the history line for ${key} should be removed; the history is ${show(historyOf(ctx))}`);
      if (ctx.ctl.gate.shouldAbandon({ id: key, timestamp: T0, data: H.lineUpData() }) !== true) p.push(`the key ${key} should be in skips`);
    } else {
      if (count(ctx, 'queue.add') !== 0) p.push('nothing may be added');
      if (count(ctx, 'writeRecord') !== 0) p.push('nothing may be recorded');
    }
    report(p, 'D8');
  }));
});

test('CT34: the confirm route\'s start cannot be refused — with a record that gives a read error it is still added (enqueued: true) and the record is never written, its bytes unchanged; with a failed write it is still added; either way the busy item reads startRecorded: false, and at its pickup the gate records no "started another way" for it [ADR 0006 D8 "an unreadable record or a failed write goes ahead unrecorded"; D11; D3 "A lineUp-made key with no start … stays unrecorded"; D12 startRecorded; story AC-5 "a start that cannot be refused … goes ahead, and shows as not recorded"]', async () => {
  await cases([
    { name: 'a read error', set: (ctx) => ctx.world.record.failReads('EIO'), noWrites: true },
    { name: 'a failed write', set: (ctx) => ctx.world.record.failWrites('ENOSPC') },
  ], (c) => withCtl('D8', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const bytes = ctx.world.record.bytes();
    c.set(ctx);
    const a = await lineUp(ctx, WHO.confirmation, 'confirm');
    const key = jobIdOfAnswer(a);
    const p = [];
    if (!enqueuedOf(a)) p.push(`the start should go ahead (enqueued: true); the answer is ${show(a.body)}`);
    if (!(typeof key === 'string' && ctx.q.has(key))) p.push(`the job should be in the queue; the answer's id is ${show(key)}`);
    if (c.noWrites && count(ctx, 'writeRecord') !== 0) p.push(`a record that gives a read error must not be written; writeRecord was called ${count(ctx, 'writeRecord')} time(s)`);
    if (ctx.world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    if (p.length === 0) {
      const { control } = await statusOf(ctx, 'signed-out', 'D12');
      const it = busyItem(control, key);
      if (!it || it.startRecorded !== false) p.push(`the busy item should read startRecorded: false; it is ${show(it)}`);
      ctx.world.record.heal();
      await gateCall('beforeAcquire', pick1(ctx, key), ctx.ctl);
      const e = entryOf(ctx, key);
      if (e && e.start && e.start.who && e.start.who.kind === 'other') p.push(`the gate recorded the confirmation's start as "started another way": ${show(e)}`);
    }
    report(p, 'D8');
  }));
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT35–CT50 — Stop: stop({ who, targets }) (D9)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT35: a Stop of a waiting pass takes it out of line — 200 { success: true, stopped: [{ key, how: \'taken-out-of-line\' }], recorded: true }; it leaves the busy list at once; the record gains its stop (who, when, runId null) with skip: true and noRerun: false, beside the Run\'s start, and a stop history line; no signal is sent; the gate then never starts it (skipped at pickup, or abandoned in the lock wait and at afterAcquire); it leaves no report, and the owner\'s pending confirmation is still pending, report.json and confirmation.json unchanged byte for byte through the Stop and the skip; a Run then lines up — for a pass in line and one waiting behind scoring, each with and without a confirmation pending [ADR 0006 D9 steps 2–5, "A waiting target\'s effect"; § Constraints "A waiting pass, or one taken out of line, writes no report"; story AC-3 "Confirming a stop of a waiting pass"; Test tasks "a stop of a waiting pass: it never begins running, leaves no report, and a pending confirmation is still pending"]', async () => {
  await cases([
    { name: 'in line', heavy: false },
    { name: 'waiting behind scoring', heavy: true },
    { name: 'in line, the owner\'s confirmation pending', heavy: false, pending: true },
    { name: 'waiting behind scoring, the owner\'s confirmation pending', heavy: true, pending: true },
  ], (c) => withCtl('D9', c.pending ? { world: { confirmation: H.confirmationRecord() } } : {}, async (ctx) => {
    const key = await runA(ctx, WHO.owner);
    const job = c.heavy ? await heavyWait(ctx, key) : null;
    ctx.world.clock.advance(MIN);
    const at = iso(T0 + MIN);
    const sideFiles = () => ({ report: exact(ctx.world.report), confirmation: exact(ctx.world.confirmation) });
    const filesBefore = sideFiles();
    const a = await stop(ctx, WHO.admin, [{ key, state: 'waiting' }]);
    expectStopped(a, [{ key, how: 'taken-out-of-line' }], true, 'D9');
    const p = [...itemsProblems((await snap(ctx)).items, [])];
    p.push(...entryProblems(ctx, key, { jobId: key, start: { at: iso(T0), who: { ...WHO.owner } }, stop: { at, runId: null, who: { ...WHO.admin } }, skip: true, noRerun: false }, 'the stop'));
    p.push(...lineProblems(historyOf(ctx), { action: 'stop', key, at, who: { ...WHO.admin } }, 'the stop'));
    if (count(ctx, 'kill') !== 0) p.push(`no signal may be sent; kill was called ${show(ctx.world.callsOf('kill'))}`);
    if (c.heavy) {
      if (ctx.ctl.gate.shouldAbandon(job) !== true) p.push('its lock wait should be abandoned (shouldAbandon true)');
      const v = await gateCall('afterAcquire', job, ctx.ctl);
      if (v !== 'skip') p.push(`afterAcquire should answer 'skip'; it answered ${show(v)}`);
    } else {
      const v = await gateCall('beforeAcquire', pick1(ctx, key), ctx.ctl);
      if (v !== 'skip') p.push(`at pickup beforeAcquire should answer 'skip'; it answered ${show(v)}`);
    }
    const filesAfter = sideFiles();
    if (filesAfter.report !== filesBefore.report) p.push(`the pass should leave no report; report.json was ${filesBefore.report} and is now ${show(ctx.world.report)}`);
    if (filesAfter.confirmation !== filesBefore.confirmation) p.push(`confirmation.json should be exactly as it was; it was ${filesBefore.confirmation} and is now ${show(ctx.world.confirmation)}`);
    if (c.pending) {
      // Not whoLeaks: confirmationPending names the owner's key (mintedBy), as it did before story 6.
      const { body } = await statusOf(ctx, 'signed-out', 'D12');
      if (body.confirmationPending == null) p.push(`the owner's confirmation should still be pending; the status's confirmationPending is ${show(body.confirmationPending)}`);
    }
    report(p, 'D9');
  }));
});

test('CT36: a Stop of a due scheduled run that is waiting (the seed id form) takes it out of line and records its schedule start at the id\'s millis beside the stop; at pickup the gate skips it, the scheduler\'s next run is at its usual slot, and no schedule entry changes — with the fake queue\'s whole surface in reach (remove and the job-scheduler calls), the queue sees only reads and adds, and the entry keeps its name, data, options and interval [ADR 0006 D9 step 4 "for a due scheduled job with no start yet, its schedule start, at the id\'s millis", "A due scheduled run\'s next run stays at its slot"; story AC-3 "The schedule", "A stop never changes any schedule entry"; probe Q3]', async () => {
  await withCtl('D9', { fullQueue: true }, async (ctx) => {
    const M = T0 - 2 * MIN;
    const sid = ctx.q.plantScheduled({ millis: M, every: EVERY });
    const before = ctx.q.scheduler(SCHED_ENTRY);
    assert(before && typeof ctx.deps.queue.removeJobScheduler === 'function' && typeof ctx.deps.queue.remove === 'function', 'setup: the controller\'s queue should reach the fake\'s whole surface (remove, removeJobScheduler)');
    const a = await stop(ctx, WHO.admin, [{ key: sid, state: 'waiting' }]);
    expectStopped(a, [{ key: sid, how: 'taken-out-of-line' }], true, 'D9');
    const p = entryProblems(ctx, sid, { jobId: sid, start: { at: iso(M), who: { ...WHO.schedule } }, stop: { at: iso(T0), runId: null, who: { ...WHO.admin } }, skip: true }, 'the scheduled run');
    p.push(...lineProblems(historyOf(ctx), { action: 'start', key: sid, at: iso(M), who: { ...WHO.schedule } }, 'the schedule\'s start'));
    p.push(...itemsProblems((await snap(ctx)).items, []));
    const job = pick1(ctx, sid);
    const v = await gateCall('beforeAcquire', job, ctx.ctl);
    if (v !== 'skip') p.push(`at pickup beforeAcquire should answer 'skip'; it answered ${show(v)}`);
    const sched = ctx.q.scheduler(SCHED_ENTRY);
    if (!sched || sched.prevMillis !== M + EVERY) p.push(`the scheduler's next run should be at ${iso(M + EVERY)}; it is ${show(sched && sched.prevMillis)}`);
    else if (exact(entryTemplate(sched)) !== exact(entryTemplate(before))) p.push(`the schedule entry should keep its template and interval ${show(entryTemplate(before))}; it is ${show(entryTemplate(sched))}`);
    const changes = queueChanges(ctx);
    if (changes.length) p.push(`the queue should see only reads and adds; it also saw ${show(changes)}`);
    report(p, 'D9');
  });
});

test('CT37: a Stop of a running pass asks it to stop — SIGTERM to the pass\'s own pid exactly once, through kill(pid, \'SIGTERM\') with a positive pid (never a group, never another signal); the record gains its stop (who, when, the runId) with noRerun: true, skip: false; it stays listed as running with stopAskedAt, and a Run is refused pass-busy, until it ends; after a restart, a stalled re-run of its job is skipped [ADR 0006 D9 steps 4–5, "A running target\'s effect"; R2; story AC-3 "Confirming a stop of a running pass"; § Seams "After a Stop of a running pass, the status still lists it as running with stopAskedAt until it ends, and a Run in that time is refused pass-busy"]', async () => {
  await withCtl('D9', async (ctx) => {
    const key = await runA(ctx, WHO.owner);
    const { rec } = await runPass(ctx, key);
    ctx.world.clock.advance(SEC);
    const at = iso(T0 + SEC);
    const a = await stop(ctx, WHO.admin, [{ key, state: 'running' }]);
    expectStopped(a, [{ key, how: 'asked-to-stop' }], true, 'D9');
    const kills = ctx.world.callsOf('kill').map((x) => x.args);
    const p = [];
    if (exact(kills) !== exact([[rec.process.pid, 'SIGTERM']])) p.push(`exactly one kill(${rec.process.pid}, 'SIGTERM') expected; the calls were ${show(kills)}`);
    p.push(...entryProblems(ctx, key, { stop: { at, runId: rec.runId, who: { ...WHO.admin } }, skip: false, noRerun: true }, 'the stop'));
    p.push(...lineProblems(historyOf(ctx), { action: 'stop', key, at, who: { ...WHO.admin } }, 'the stop'));
    p.push(...itemsProblems((await snap(ctx)).items, [{ key, state: 'running', stopAskedAt: T0 + SEC, runId: rec.runId }]));
    p.push(...codeProblems(await lineUp(ctx, WHO.owner), 'pass-busy', 409).map((x) => `a Run while it still runs: ${x}`));
    ctx.world.endPass({ state: 'stopped' });
    p.push(...itemsProblems((await snap(ctx)).items, []).map((x) => `once it ended: ${x}`));
    ctx.q.stall(key);
    const ctl2 = restart(ctx);
    const v = await gateCall('beforeAcquire', pick1(ctx, key), ctl2);
    if (v !== 'skip') p.push(`after a restart, its stalled re-run should be skipped; beforeAcquire answered ${show(v)}`);
    report(p, 'D9');
  });
});

test('CT38: a Stop acts only on what its prompt showed — a prompt that said waiting for a pass now starting or running, or that misses a pass lined up since, is refused 409 { code: \'prompt-out-of-date\', busy } and changes nothing (no mark, no record, no signal); a pass picked up but still waiting for the lock is still waiting; and a prompt naming two busy passes stops both [ADR 0006 D9 step 2 "Stale prompt"; story AC-3 "What it acts on … never does more than its prompt said"]', async () => {
  const K2 = H.lineUpKey(61);
  await cases([
    { name: 'said waiting; now starting', setup: async (ctx) => { const k = await runA(ctx); await launch(ctx, k); return { targets: [{ key: k, state: 'waiting' }] }; }, stale: true },
    { name: 'said waiting; now running', setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); return { targets: [{ key: k, state: 'waiting' }] }; }, stale: true },
    { name: 'misses a pass lined up since', setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); await addJob(ctx, K2); return { targets: [{ key: k, state: 'running' }] }; }, stale: true },
    { name: 'said waiting; picked up, still waiting for the lock', setup: async (ctx) => { const k = await runA(ctx); await heavyWait(ctx, k); return { targets: [{ key: k, state: 'waiting' }], want: [{ key: k, how: 'taken-out-of-line' }] }; } },
    {
      name: 'two busy passes, both named',
      setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); const s = ctx.q.plantScheduled({ millis: T0 - MIN, every: EVERY }); return { targets: [{ key: k, state: 'running' }, { key: s, state: 'waiting' }], want: [{ key: k, how: 'asked-to-stop' }, { key: s, how: 'taken-out-of-line' }] }; },
    },
  ], (c) => withCtl('D9', async (ctx) => {
    const { targets, want } = await c.setup(ctx);
    const writes = count(ctx, 'writeRecord');
    const a = await stop(ctx, WHO.admin, targets);
    if (!c.stale) { expectStopped(a, want, true, 'D9'); return; }
    const p = codeProblems(a, 'prompt-out-of-date', 409);
    if (!Array.isArray(a.body.busy)) p.push(`the refusal should carry busy: the current items; it is ${show(a.body)}`);
    if (count(ctx, 'writeRecord') !== writes) p.push('a refused Stop recorded something');
    if (count(ctx, 'kill') !== 0) p.push('a refused Stop sent a signal');
    const s = await snap(ctx);
    if (s.items.some((i) => i.stopAskedAt != null) || !targets.every((t) => itemOf(s.items, t.key))) p.push(`nothing may be marked; the items are ${show(s.items)}`);
    report(p, 'D9');
  }));
});

test('CT39: a Stop with nothing to stop is refused 409 { code: \'nothing-to-stop\' } and changes nothing — nothing busy; every busy pass already has a stop asked; a second Stop of a pass already taken out of line — and a target that ended meanwhile is left out while the other target is acted on [ADR 0006 D9 step 2 "Nothing left"; story AC-3 "Nothing to stop"]', async () => {
  await cases([
    { name: 'nothing busy', setup: async () => ({ targets: [{ key: H.lineUpKey(71), state: 'waiting' }] }) },
    { name: 'every busy pass already has a stop asked', setup: async (ctx) => { const k = await runA(ctx); await runPass(ctx, k); await stop(ctx, WHO.owner, [{ key: k, state: 'running' }]); return { targets: [{ key: k, state: 'running' }] }; } },
    { name: 'a second Stop of a pass taken out of line', setup: async (ctx) => { const k = await runA(ctx); await stop(ctx, WHO.owner, [{ key: k, state: 'waiting' }]); return { targets: [{ key: k, state: 'waiting' }] }; } },
    {
      name: 'one target ended meanwhile',
      setup: async (ctx) => { const a = await addJob(ctx, H.lineUpKey(72)); const b = await addJob(ctx, H.lineUpKey(73)); await ctx.q.remove(a); return { targets: [{ key: a, state: 'waiting' }, { key: b, state: 'waiting' }], want: [{ key: b, how: 'taken-out-of-line' }] }; },
    },
  ], (c) => withCtl('D9', async (ctx) => {
    const { targets, want } = await c.setup(ctx);
    const writes = count(ctx, 'writeRecord');
    const kills = count(ctx, 'kill');
    const a = await stop(ctx, WHO.admin, targets);
    if (want) { expectStopped(a, want, true, 'D9'); return; }
    report([...codeProblems(a, 'nothing-to-stop', 409),
      count(ctx, 'writeRecord') !== writes && 'a refused Stop recorded something',
      count(ctx, 'kill') !== kills && 'a refused Stop sent a signal'], 'D9');
  }));
});

test('CT40: a scheduled run that comes due while a stopped pass still runs is not covered by that stop — it shows waiting with no stop asked — and a Stop takes it out of line in its turn, the first pass keeping its stop [story AC-3 "A pass that lines up after a stop was asked for is not covered by that stop, and Stop applies to it in its turn"; Test tasks "a scheduled run that comes due while a stopped pass is still running"; ADR 0006 D9 "The skip is per job"]', async () => {
  await withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    await runPass(ctx, k);
    await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
    ctx.world.clock.advance(2 * MIN);
    const s = ctx.q.plantScheduled({ millis: T0 + MIN, every: EVERY });
    const items = (await snap(ctx)).items;
    expectItems(items, [{ key: k, state: 'running', stopAskedAt: T0 }, { key: s, state: 'waiting', behind: 'pass', stopAskedAt: null }], 'after the first Stop', 'D9', { ordered: true });
    const a = await stop(ctx, WHO.owner, targetsOf(items));
    expectStopped(a, [{ key: s, how: 'taken-out-of-line' }], true, 'D9');
    expectItems((await snap(ctx)).items, [{ key: k, state: 'running', stopAskedAt: T0 }], 'after the second Stop', 'D9');
  });
});

test('CT41: a Stop of a pass that is starting (no pid yet) waits for its first record — a live latest with its job id and a startedAt no earlier than its launch — and signals that pid; an earlier ended run of the same legacy id is not taken for it [ADR 0006 D9 step 3 "No pid yet … PID_WAIT_MS = 3000, re-reading report.json every 100 ms"]', async () => {
  await cases([
    { name: 'a pass lined up by Run', setup: async (ctx) => { const k = await runA(ctx); return { key: k, jobId: k, job: await launch(ctx, k) }; } },
    {
      name: 'a legacy-id job after an earlier legacy run',
      setup: async (ctx) => {
        ctx.world.startPass({ jobId: LEGACY_ID, startedAt: iso(T0 - HOUR) });
        ctx.world.endPass({ state: 'done', endedAt: iso(T0 - HOUR + 3 * SEC) });
        await addJob(ctx, LEGACY_ID);
        return { key: `${LEGACY_ID}@${T0}`, jobId: LEGACY_ID, job: await launch(ctx, LEGACY_ID) };
      },
    },
  ], (c) => withCtl('D9', async (ctx) => {
    const { key, jobId } = await c.setup(ctx);
    expectItems((await snap(ctx)).items, [{ key, state: 'running', runId: null }], 'starting', 'D5');
    const pending = stop(ctx, WHO.admin, [{ key, state: 'running' }]);
    await H.sleep(50);
    const rec = ctx.world.startPass({ jobId });
    const a = await pending;
    expectStopped(a, [{ key, how: 'asked-to-stop' }], true, 'D9');
    report([exact(ctx.world.callsOf('kill').map((x) => x.args)) !== exact([[rec.process.pid, 'SIGTERM']]) && `kill(${rec.process.pid}, 'SIGTERM') expected once; the calls were ${show(ctx.world.callsOf('kill'))}`,
      ...entryProblems(ctx, key, { stop: { at: iso(T0), runId: rec.runId, who: { ...WHO.admin } } }, 'the stop')], 'D9');
  }));
});

test('CT42: the pid wait ends early — a pass refused at its identity check before its pid showed makes the stop too late (recorded with that run\'s runId, no signal); a job that ends with no report is left out (409 nothing-to-stop when nothing is left, recording nothing; the other target acted on when one is) [ADR 0006 D9 step 3 "The wait ends early in two cases"; story AC-3 "A stop that comes too late … including a pass refused at its start checks"; § Seams "A Stop catches a pass while it is starting, the pass is then refused at its identity check, and the answer is too-late with the stop recorded"]', async () => {
  await withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    await launch(ctx, k);
    const pending = stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
    await H.sleep(50);
    const rec = ctx.world.startPass({ jobId: k });
    ctx.world.endPass({ state: 'refused' });
    const a = await pending;
    expectStopped(a, [{ key: k, how: 'too-late' }], true, 'D9');
    report([count(ctx, 'kill') !== 0 && 'no signal may be sent',
      ...entryProblems(ctx, k, { stop: { at: iso(T0), runId: rec.runId, who: { ...WHO.admin } } }, 'the too-late stop')], 'D9');
  });
  await cases([
    { name: 'the only target', other: false },
    { name: 'beside a waiting target', other: true },
  ], (c) => withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    const job = await launch(ctx, k);
    const b = c.other ? await addJob(ctx, H.lineUpKey(81)) : null;
    const targets = [{ key: k, state: 'running' }].concat(b ? [{ key: b, state: 'waiting' }] : []);
    const writes = count(ctx, 'writeRecord');
    const pending = stop(ctx, WHO.admin, targets);
    await H.sleep(50);
    ctx.ctl.gate.ended(job);
    const a = await pending;
    if (c.other) expectStopped(a, [{ key: b, how: 'taken-out-of-line' }], true, 'D9');
    else report([...codeProblems(a, 'nothing-to-stop', 409), count(ctx, 'writeRecord') !== writes && 'nothing may be recorded'], 'D9');
    report([count(ctx, 'kill') !== 0 && 'no signal may be sent', entryOf(ctx, k) && entryOf(ctx, k).stop && `no stop may be recorded for ${k}: ${show(entryOf(ctx, k))}`], 'D9');
  }));
});

test('CT43: a starting pass whose record does not appear within the pid wait (300 ms here) is refused 409 { code: \'pass-not-reachable\' } and nothing changes — no record, no mark, no signal, and a waiting target in the same Stop is not taken out of line (running targets first) [ADR 0006 D9 step 3 "If neither happens within PID_WAIT_MS: 409 pass-not-reachable. Nothing changes."]', async () => {
  await withCtl('D9', { world: { timers: { pidWaitMs: 300 } } }, async (ctx) => {
    const k = await runA(ctx);
    const job = await launch(ctx, k);
    const b = await addJob(ctx, H.lineUpKey(82));
    const writes = count(ctx, 'writeRecord');
    const untick = ticker(ctx.world.clock, 10);
    let a;
    try { a = await stop(ctx, WHO.admin, [{ key: k, state: 'running' }, { key: b, state: 'waiting' }], { limit: 5000 }); } finally { untick(); }
    const p = codeProblems(a, 'pass-not-reachable', 409);
    if (count(ctx, 'writeRecord') !== writes) p.push('nothing may be recorded');
    if (count(ctx, 'kill') !== 0) p.push('no signal may be sent');
    p.push(...itemsProblems((await snap(ctx)).items, [{ key: k, state: 'running', stopAskedAt: null }, { key: b, state: 'waiting', stopAskedAt: null }]));
    if (ctx.ctl.gate.shouldAbandon(job) !== false) p.push('the starting pass may not be marked');
    report(p, 'D9');
  });
});

test('CT44: the signal is checked just before it is sent — the report re-read must still show this job\'s run, no earlier than its launch, not ended, and alive — so when, after the record write, the pass ended, its pid was reused by another process, or another pass became the latest, no signal is sent; and kill throwing ESRCH also makes it too late; each answers too-late with the stop recorded [ADR 0006 D9 step 4 "Then the signal"; story AC-3 "A stop that comes too late"]', async () => {
  await cases([
    { name: 'the pass ended', mutate: (ctx) => ctx.world.endPass({ state: 'done' }) },
    { name: 'its pid reused by another process', mutate: (ctx, rec) => ctx.world.procs.reuse(rec.process.pid, '111') },
    { name: 'another pass is now the latest', mutate: (ctx) => { ctx.world.endPass({ state: 'done' }); ctx.world.startPass({ jobId: H.lineUpKey(91) }); } },
    { name: 'kill throws ESRCH', set: (ctx) => { ctx.world.killError = 'ESRCH'; } },
  ], (c) => withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k);
    if (c.set) c.set(ctx);
    if (c.mutate) ctx.hooks.after.writeRecord = once(() => c.mutate(ctx, rec));
    const a = await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
    expectStopped(a, [{ key: k, how: 'too-late' }], true, 'D9');
    report([ctx.world.kills.length !== 0 && `no process may be signalled; signalled ${show(ctx.world.kills)}`,
      ...entryProblems(ctx, k, { stop: { at: iso(T0), runId: rec.runId, who: { ...WHO.admin } } }, 'the stop')], 'D9');
  }));
});

test('CT45: a legacy-id pass is stopped by job id — its key reconcileTaggingEdges@<timestamp> resolves to the job id reconcileTaggingEdges, which the report\'s job.id matches, so it is signalled [ADR 0006 D2 jobIdOf "Every comparison with a report\'s job.id uses jobIdOf, never the key"; D9; R7; § Seams "A legacy-id pass is stopped by job id"]', async () => {
  await withCtl('D9', async (ctx) => {
    await addJob(ctx, LEGACY_ID);
    const { rec } = await runPass(ctx, LEGACY_ID);
    const key = `${LEGACY_ID}@${T0}`;
    const a = await stop(ctx, WHO.admin, [{ key, state: 'running' }]);
    expectStopped(a, [{ key, how: 'asked-to-stop' }], true, 'D9');
    report([exact(ctx.world.kills) !== exact([{ pid: rec.process.pid, signal: 'SIGTERM' }]) && `the legacy pass's pid should get SIGTERM; signalled ${show(ctx.world.kills)}`], 'D9');
  });
});

test('CT46: a run:<runId> target — a hand run with no job, and an orphan after a restart whose own job is being run again — is signalled by its runId; its stop entry goes under run:<runId> with jobId the report\'s job id (or null); for a non-legacy job id only noRerun goes under that id, in memory (the re-run is no longer listed and its lock wait is abandoned) and as noRerun: true on that id\'s entry [ADR 0006 D9 step 4 "A run: target"; D5 rule 3; story Test tasks "a stopped hand run, which has no job id"]', async () => {
  await withCtl('D9', async (ctx) => {
    const rec = ctx.world.startPass({ jobId: null });
    const key = `run:${rec.runId}`;
    const a = await stop(ctx, WHO.admin, [{ key, state: 'running' }]);
    expectStopped(a, [{ key, how: 'asked-to-stop' }], true, 'D9');
    report([exact(ctx.world.kills) !== exact([{ pid: rec.process.pid, signal: 'SIGTERM' }]) && `the hand run's pid should get SIGTERM; signalled ${show(ctx.world.kills)}`,
      ...entryProblems(ctx, key, { jobId: null, stop: { at: iso(T0), runId: rec.runId, who: { ...WHO.admin } } }, 'the hand run\'s stop')], 'D9');
  });
  await withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k);
    ctx.world.clock.advance(MIN);
    ctx.q.stall(k);
    const ctl2 = restart(ctx);
    const job = await heavyWait(ctx, k, ctl2);
    const runKey = `run:${rec.runId}`;
    const items = (await snap(ctx, { ctl: ctl2 })).items;
    expectItems(items, [{ key: runKey, jobId: k, state: 'running' }, { key: k, state: 'waiting', behind: 'heavy-work' }], 'the orphan and its job run again', 'D5', { ordered: true });
    const a = await stop(ctx, WHO.admin, targetsOf(items), { ctl: ctl2 });
    expectStopped(a, [{ key: runKey, how: 'asked-to-stop' }, { key: k, how: 'taken-out-of-line' }], true, 'D9');
    const p = [];
    if (exact(ctx.world.kills) !== exact([{ pid: rec.process.pid, signal: 'SIGTERM' }])) p.push(`the orphan's pid should get SIGTERM; signalled ${show(ctx.world.kills)}`);
    p.push(...entryProblems(ctx, runKey, { jobId: k, stop: { at: iso(T0 + MIN), runId: rec.runId, who: { ...WHO.admin } } }, 'the orphan\'s stop'));
    p.push(...entryProblems(ctx, k, { noRerun: true }, 'its job id'));
    if (ctl2.gate.shouldAbandon(job) !== true) p.push('the job\'s lock wait should be abandoned');
    ctx.world.endPass({ state: 'stopped' });
    p.push(...itemsProblems((await snap(ctx, { ctl: ctl2 })).items, []).map((x) => `once the orphan ended: ${x}`));
    report(p, 'D9');
  });
});

test('CT47: after a restart, an admin stops the orphaned pass; the orphan ends while its job is still stale-active; the busy list is then empty and a Run lines up a pass; the stale job, once stalled back, is skipped [§ Seams "New cases the review named"; ADR 0006 D5 "Any other execution of a noRerun key … is never busy"; D9]', async () => {
  await withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k);
    const ctl2 = restart(ctx);
    const items = (await snap(ctx, { ctl: ctl2 })).items;
    expectItems(items, [{ key: k, state: 'running', runId: rec.runId }], 'the orphan after a restart', 'D5');
    expectStopped(await stop(ctx, WHO.admin, [{ key: k, state: 'running' }], { ctl: ctl2 }), [{ key: k, how: 'asked-to-stop' }], true, 'D9');
    ctx.world.endPass({ state: 'stopped' });
    const p = itemsProblems((await snap(ctx, { ctl: ctl2 })).items, []).map((x) => `with the job still stale-active: ${x}`);
    let k2 = null;
    try { k2 = await runA(ctx, WHO.owner, ctl2); } catch (e) { p.push(`a Run: ${firstLine(e)}`); }
    ctx.q.stall(k);
    const v = await gateCall('beforeAcquire', pick1(ctx, k), ctl2);
    if (v !== 'skip') p.push(`the stale job, stalled back and picked up, should be skipped; beforeAcquire answered ${show(v)}`);
    if (k2 && ctx.q.state(k2) !== 'waiting') p.push(`the new pass should be waiting behind it; it is ${ctx.q.state(k2)}`);
    report(p, 'D9');
  });
});

test('CT48: a running pass can be stopped while the queue cannot be read — Redis not ready, never initialised, or a failed read — because it is the snapshot\'s liveness item; a Stop naming any other target is then refused 503 { code: \'QUEUE_UNAVAILABLE\' } and changes nothing [ADR 0006 D9 step 1 "If queue !== \'ok\' and any target is not the snapshot\'s liveness item"; Pros "Stop needs no disk"]', async () => {
  await cases([
    { name: 'Redis not ready', set: (ctx) => { ctx.world.health = 'not-ready'; } },
    { name: 'never initialised', set: (ctx) => { ctx.world.health = 'off'; } },
    { name: 'a failed read', set: (ctx) => ctx.q.inject('getActive', { error: 'ECONNRESET', times: 10 }) },
  ], (c) => withCtl('D9', async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k);
    const w = await addJob(ctx, H.lineUpKey(83));
    c.set(ctx);
    const refused = await stop(ctx, WHO.admin, [{ key: w, state: 'waiting' }]);
    const p = codeProblems(refused, 'QUEUE_UNAVAILABLE', 503).map((x) => `a waiting target: ${x}`);
    if (count(ctx, 'kill') !== 0 || entryOf(ctx, w) && entryOf(ctx, w).stop) p.push('the refused Stop changed something');
    const a = await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
    try { expectStopped(a, [{ key: k, how: 'asked-to-stop' }], true, 'D9'); } catch (e) { p.push(`the running pass: ${firstLine(e)}`); }
    if (exact(ctx.world.kills) !== exact([{ pid: rec.process.pid, signal: 'SIGTERM' }])) p.push(`its pid should get SIGTERM; signalled ${show(ctx.world.kills)}`);
    report(p, 'D9');
  }));
});

test('CT49: a Stop that cannot be recorded still takes effect and answers recorded: false — with a failed write the waiting pass leaves the line and is skipped, the running one is signalled and listed with its stopAskedAt; with a record that gives a read error nothing is written at all and its bytes stay unchanged, byte for byte [ADR 0006 D9 "A failed or refused write leaves the effect in place and sets recorded: false"; D11; story AC-5 "a Stop still takes effect, its answer says it was not recorded"; § Seams "A record that gives a read error is unchanged, byte for byte, after a Stop"]', async () => {
  // A read error is noticed at a read (D11: "Before writing, a step re-reads the record if its last read was not
  // readable"), so it is set before the controller's first read, and the running pass is lined up another way; a
  // failed write is set after a Run that recorded its start.
  await cases([
    { name: 'a failed write', before: () => {}, after: (ctx) => ctx.world.record.failWrites('ENOSPC'), lineUpByRun: true },
    { name: 'a read error', before: (ctx) => ctx.world.record.failReads('EIO'), after: () => {}, noWrites: true },
  ], (c) => withCtl('D9', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const bytes0 = ctx.world.record.bytes();
    c.before(ctx);
    const k = c.lineUpByRun ? await runA(ctx) : await addJob(ctx, H.lineUpKey(84));
    const { rec } = await runPass(ctx, k);
    ctx.world.clock.advance(2 * MIN);
    const s = ctx.q.plantScheduled({ millis: T0 + MIN, every: EVERY });
    const writes = count(ctx, 'writeRecord');
    const bytes = ctx.world.record.bytes();
    if (c.noWrites && bytes !== bytes0) throw new Error(`setup: the record was written while it gave a read error (${adr('D11')})`);
    c.after(ctx);
    const a = await stop(ctx, WHO.admin, [{ key: k, state: 'running' }, { key: s, state: 'waiting' }]);
    expectStopped(a, [{ key: k, how: 'asked-to-stop' }, { key: s, how: 'taken-out-of-line' }], false, 'D9');
    const p = [];
    if (exact(ctx.world.kills) !== exact([{ pid: rec.process.pid, signal: 'SIGTERM' }])) p.push(`the running pass should get SIGTERM; signalled ${show(ctx.world.kills)}`);
    p.push(...itemsProblems((await snap(ctx)).items, [{ key: k, state: 'running', stopAskedAt: T0 + 2 * MIN }]));
    if (c.noWrites && count(ctx, 'writeRecord') !== writes) p.push(`a record that gives a read error must not be written; writeRecord was called ${count(ctx, 'writeRecord') - writes} more time(s)`);
    if (ctx.world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    report(p, 'D9');
  }));
});

test('CT50: either may act on the other\'s pass — an admin stops the owner\'s running pass, one that has taken up the owner\'s confirmation (the status said so), and the owner stops an admin\'s waiting pass; the record keeps each start\'s who and each stop\'s who [story AC-4 "Either may act on the other\'s pass … That includes a pass that is applying the owner\'s confirmation"; ADR 0006 D9; D12 "\'taken-up\'"]', async () => {
  await withCtl('D9', { world: { confirmation: H.confirmationRecord() } }, async (ctx) => {
    const k = await runA(ctx, WHO.owner);
    const { rec } = await runPass(ctx, k, { through: 'graph-read' });
    ctx.world.claim(rec.runId, { save: true });
    const { control } = await statusOf(ctx, 'signed-out', 'D12');
    const p = [];
    const it = busyItem(control, k);
    if (!it || it.confirmation !== 'taken-up') p.push(`the status should say the running pass took the confirmation up; its item is ${show(it)}`);
    ctx.world.clock.advance(SEC);
    expectStopped(await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]), [{ key: k, how: 'asked-to-stop' }], true, 'D9');
    p.push(...entryProblems(ctx, k, { start: { at: iso(T0), who: { ...WHO.owner } }, stop: { at: iso(T0 + SEC), runId: rec.runId, who: { ...WHO.admin } } }, 'the owner\'s pass'));
    report(p, 'D9');
  });
  await withCtl('D9', async (ctx) => {
    const k = await runA(ctx, WHO.admin);
    expectStopped(await stop(ctx, WHO.owner, [{ key: k, state: 'waiting' }]), [{ key: k, how: 'taken-out-of-line' }], true, 'D9');
    report(entryProblems(ctx, k, { start: { at: iso(T0), who: { ...WHO.admin } }, stop: { at: iso(T0), runId: null, who: { ...WHO.owner } } }, 'the admin\'s pass'), 'D9');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT51–CT57 — the record (D11)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT51: the record\'s shape — { version: 1, passes: { <key>: { jobId, start: { at, who } | null, stop: { at, runId, who } | null, skip, noRerun, gaveUpAt } }, history: [{ action: \'start\' | \'stop\', key, at, who }] } — after starts by the owner, an admin, a local call, the confirmation and the schedule, and stops; who is { kind } with an 8-hex key for the owner or an admin only; field names who, kind and key, never changedBy; no full pubkey [ADR 0006 D11 "Shape"; D14; story AC-5 "What is recorded"]', async () => {
  await withCtl('D11', async (ctx) => {
    const k1 = await runA(ctx, WHO.owner);
    ctx.world.clock.advance(SEC);
    await stop(ctx, WHO.admin, [{ key: k1, state: 'waiting' }]);
    const j1 = pick1(ctx, k1);
    await gateCall('beforeAcquire', j1, ctx.ctl, 'skip');
    ctx.q.complete(j1.id, ctx.ctl.gate.skipped(j1));
    ctx.world.clock.advance(SEC);
    const k2 = await runA(ctx, WHO.local);
    ctx.q.complete(pick1(ctx, k2).id);
    ctx.world.clock.advance(SEC);
    const k3 = await runA(ctx, WHO.admin);
    ctx.q.complete(pick1(ctx, k3).id);
    ctx.world.clock.advance(SEC);
    const c = await lineUp(ctx, WHO.confirmation, 'confirm');
    const k4 = jobIdOfAnswer(c);
    ctx.q.complete(pick1(ctx, k4).id);
    ctx.world.clock.advance(SEC);
    const sid = ctx.q.plantScheduled({ millis: ctx.world.clock.now() - 100, every: EVERY });
    await stop(ctx, WHO.owner, [{ key: sid, state: 'waiting' }]);
    const r = recordOf(ctx);
    const p = [];
    if (!r || r.version !== 1 || !r.passes || typeof r.passes !== 'object' || !Array.isArray(r.history)) p.push(`the record should be { version: 1, passes, history }; it is ${show(r)}`);
    const whoOk = (w) => !!w && ['owner', 'admin', 'schedule', 'confirmation', 'local', 'other'].includes(w.kind)
      && (['owner', 'admin'].includes(w.kind) ? /^[0-9a-f]{8}$/.test(w.key) && Object.keys(w).length === 2 : Object.keys(w).length === 1);
    for (const [key, e] of Object.entries((r && r.passes) || {})) {
      if (exact(Object.keys(e).sort()) !== exact(ENTRY_FIELDS.slice().sort())) p.push(`${key}: the entry should have exactly ${show(ENTRY_FIELDS)}; it has ${show(Object.keys(e))}`);
      if (e.start !== null && !(e.start && ISO_RE.test(e.start.at) && whoOk(e.start.who) && Object.keys(e.start).length === 2)) p.push(`${key}: start should be null or { at, who }; it is ${show(e.start)}`);
      if (e.stop !== null && !(e.stop && ISO_RE.test(e.stop.at) && has(e.stop, 'runId') && whoOk(e.stop.who) && Object.keys(e.stop).length === 3)) p.push(`${key}: stop should be null or { at, runId, who }; it is ${show(e.stop)}`);
      if (typeof e.skip !== 'boolean' || typeof e.noRerun !== 'boolean') p.push(`${key}: skip and noRerun should be booleans`);
    }
    for (const l of (r && r.history) || []) {
      if (!(['start', 'stop'].includes(l.action) && typeof l.key === 'string' && ISO_RE.test(l.at) && whoOk(l.who) && Object.keys(l).length === 4)) p.push(`a history line should be { action, key, at, who }; one is ${show(l)}`);
    }
    const kinds = new Set(Object.values((r && r.passes) || {}).map((e) => e.start && e.start.who && e.start.who.kind));
    for (const kind of ['owner', 'admin', 'local', 'confirmation', 'schedule']) if (!kinds.has(kind)) p.push(`a start by ${kind} should be recorded; the starts' kinds are ${show([...kinds])}`);
    const bytes = String(ctx.world.record.bytes());
    if (bytes.includes('changedBy')) p.push('the record names changedBy');
    if (bytes.includes(OWNER) || bytes.includes(ADMIN)) p.push('the record holds a full pubkey');
    report(p, 'D11');
  });
});

test('CT52: the history keeps the last 10 actions, newest first, sorted by `at` — after 12 Runs it holds the newest 10; a scheduled run\'s start, written late at its pickup with its due time, sorts into place by its time rather than going on top [ADR 0006 D11 "history is newest first, at most 10, and sorted by at, because a schedule start can be written late, at its due time"; story AC-5 "the last 10 actions, newest first"]', async () => {
  await withCtl('D11', async (ctx) => {
    const keys = [];
    for (let i = 0; i < 12; i += 1) {
      keys.push(await runA(ctx, i % 2 ? WHO.admin : WHO.owner));
      ctx.q.complete(pick1(ctx, keys[i]).id);
      ctx.world.clock.advance(MIN);
    }
    const p = [];
    let h = historyOf(ctx);
    const want = keys.slice(2).reverse();
    if (exact(h.map((l) => l.key)) !== exact(want)) p.push(`after 12 Runs the history should name ${show(want)}, newest first; it names ${show(h.map((l) => l.key))}`);
    const due = T0 + 10 * MIN + 30 * SEC;
    const sid = ctx.q.plantScheduled({ millis: due, every: EVERY });
    await gateCall('beforeAcquire', pick1(ctx, sid), ctx.ctl, 'go');
    h = historyOf(ctx);
    const order = h.map((l) => l.key);
    const wantOrder = [keys[11], sid, keys[10], ...keys.slice(3, 10).reverse()];
    if (exact(order) !== exact(wantOrder)) p.push(`the schedule's start at ${iso(due)} should sit between the Runs at ${iso(T0 + 11 * MIN)} and ${iso(T0 + 10 * MIN)}; the history names ${show(order)}`);
    if (!h.every((l, i) => i === 0 || Date.parse(h[i - 1].at) >= Date.parse(l.at))) p.push(`the history should be sorted by at, newest first; it is ${show(h.map((l) => l.at))}`);
    report(p, 'D11');
  });
});

/** A record with entries of every pruning class (D11), and a report and queue to match. */
async function pruningWorld(ctx) {
  const at = (i) => iso(T0 - HOUR + i * SEC);
  const passes = {};
  const history = [];
  const named = [];
  for (let i = 0; i < 9; i += 1) {
    const k = H.lineUpKey(200 + i);
    named.push(k);
    passes[k] = H.recordEntry({ jobId: k, start: { at: at(i), who: { ...WHO.owner } } });
    history.unshift(H.historyLine('start', k, at(i), { ...WHO.owner }));
  }
  const reportRun = H.lineUpKey(300);
  passes[`run-entry-${reportRun}`] = H.recordEntry({ jobId: reportRun, start: { at: at(20), who: { ...WHO.admin } } });
  const stale = [];
  for (let i = 0; i < 45; i += 1) {
    const k = H.lineUpKey(400 + i);
    stale.push(k);
    passes[k] = H.recordEntry({ jobId: k, start: { at: at(30 + i), who: { ...WHO.local } } });
  }
  const skipFound = H.lineUpKey(500);
  const noRerunGone = H.lineUpKey(501);
  passes[skipFound] = H.recordEntry({ jobId: skipFound, skip: true, stop: { at: at(80), runId: null, who: { ...WHO.admin } } });
  passes[noRerunGone] = H.recordEntry({ jobId: noRerunGone, noRerun: true, stop: { at: at(81), runId: null, who: { ...WHO.admin } } });
  ctx.world.record.set(H.recordFile({ passes, history }));
  ctx.world.startPass({ jobId: reportRun, startedAt: iso(T0 - 2 * HOUR) });
  ctx.world.endPass({ state: 'done', endedAt: iso(T0 - 2 * HOUR + 3 * SEC) });
  await addJob(ctx, skipFound);
  return { named, reportEntry: `run-entry-${reportRun}`, stale, skipFound, noRerunGone };
}

test('CT53: pruning keeps, up to 40 entries, the keys still busy, the keys the history names and the entries joined to a run in report.json; it drops stale entries; outside the cap it keeps an entry with skip or noRerun whose job the last queue read still found, and drops one whose job it did not find [ADR 0006 D11 "Pruning"]', async () => {
  await withCtl('D11', async (ctx) => {
    const w = await pruningWorld(ctx);
    const k = await runA(ctx);
    const passes = (recordOf(ctx) || {}).passes || {};
    const kept = Object.keys(passes);
    const p = [];
    for (const key of [k, ...w.named, w.reportEntry]) if (!kept.includes(key)) p.push(`${key} should be kept`);
    if (!kept.includes(w.skipFound)) p.push(`${w.skipFound} (skip, its job still in the queue) should be kept outside the cap`);
    if (kept.includes(w.noRerunGone)) p.push(`${w.noRerunGone} (noRerun, its job gone) should be dropped`);
    const staleKept = w.stale.filter((s) => kept.includes(s));
    if (staleKept.length) p.push(`${staleKept.length} stale entries were kept (busy nowhere, named by no history line, joined to no run)`);
    const inCap = kept.filter((x) => !(passes[x].skip || passes[x].noRerun));
    if (inCap.length > 40) p.push(`at most 40 entries besides skip and noRerun ones; there are ${inCap.length}`);
    report(p, 'D11');
  });
});

test('CT54: pruning keeps every skip or noRerun entry when no queue read has happened yet in this process (a Stop of the running pass with Redis not ready) or the last read failed [ADR 0006 D11 "All such entries are kept when that read failed, or when no read has happened yet in this process"]', async () => {
  await cases([
    { name: 'no read yet', set: (ctx) => { ctx.world.health = 'not-ready'; } },
    { name: 'the last read failed', set: (ctx) => ctx.q.inject('getActive', { error: 'ECONNRESET', times: 10 }) },
  ], (c) => withCtl('D11', async (ctx) => {
    const w = await pruningWorld(ctx);
    const rec = ctx.world.startPass({ jobId: null });
    c.set(ctx);
    const a = await stop(ctx, WHO.admin, [{ key: `run:${rec.runId}`, state: 'running' }]);
    expectStopped(a, [{ key: `run:${rec.runId}`, how: 'asked-to-stop' }], true, 'D9');
    const kept = Object.keys((recordOf(ctx) || {}).passes || {});
    report([!kept.includes(w.noRerunGone) && `${w.noRerunGone} (noRerun) should be kept`, !kept.includes(w.skipFound) && `${w.skipFound} (skip) should be kept`], 'D11');
  }));
});

test('CT55: a record that gives a read error is never written while it does — a Run is refused record-unavailable, a Stop takes effect with recorded: false, a scheduled run\'s start goes ahead unrecorded, the confirmation\'s start goes ahead, a give-up is not recorded — its bytes unchanged, byte for byte; a later successful re-read clears it, and the next Stop is recorded [ADR 0006 D11 "Writing around a bad file"; § Seams "A record that gives a read error is unchanged, byte for byte, after a Stop and after a scheduled start"]', async () => {
  await withCtl('D11', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const bytes = ctx.world.record.bytes();
    ctx.world.record.failReads('EIO');
    const p = [];
    p.push(...codeProblems(await lineUp(ctx, WHO.owner), 'record-unavailable', 500).map((x) => `a Run: ${x}`));
    const sid = ctx.q.plantScheduled({ millis: T0 - MIN, every: EVERY });
    const sjob = pick1(ctx, sid);
    const v = await gateCall('beforeAcquire', sjob, ctx.ctl);
    if (v !== 'go') p.push(`the scheduled run should go ahead; beforeAcquire answered ${show(v)}`);
    await within(ctx.ctl.gate.gaveUp(sjob, Object.assign(new Error('gave up'), { code: WAIT_TIMEOUT })), 3000, 'gate.gaveUp');
    ctx.ctl.gate.ended(sjob);
    ctx.q.fail(sid, new Error('gave up'));
    const c = await lineUp(ctx, WHO.confirmation, 'confirm');
    if (!enqueuedOf(c)) p.push(`the confirmation's start should go ahead; it answered ${show(c.body)}`);
    const ck = jobIdOfAnswer(c);
    const st = await stop(ctx, WHO.admin, [{ key: ck, state: 'waiting' }]);
    try { expectStopped(st, [{ key: ck, how: 'taken-out-of-line' }], false, 'D9'); } catch (e) { p.push(firstLine(e)); }
    if (count(ctx, 'writeRecord') !== 0) p.push(`nothing may write the record while it gives a read error; writeRecord was called ${count(ctx, 'writeRecord')} time(s)`);
    if (ctx.world.record.bytes() !== bytes) p.push('the record\'s bytes changed');
    ctx.world.record.heal();
    const k = await addJob(ctx, H.lineUpKey(600));
    const st2 = await stop(ctx, WHO.admin, [{ key: k, state: 'waiting' }]);
    try { expectStopped(st2, [{ key: k, how: 'taken-out-of-line' }], true, 'D9'); } catch (e) { p.push(`after the read heals: ${firstLine(e)}`); }
    report(p, 'D11');
  });
});

test('CT55b: a scheduled run whose start cannot be recorded goes ahead and shows as not recorded — with a write that fails (ENOSPC) or a record that gives a read error, the due run picked up is let through (\'go\'), the record holds no start for it, and the status\'s busy item reads startRecorded: false; with a healthy record the same pickup records the schedule\'s start at the id\'s millis and reads startRecorded: true [story AC-5 "a start that cannot be refused (a schedule\'s, or the confirm route\'s) goes ahead, and shows as not recorded"; ADR 0006 D3 "A schedule\'s start cannot be refused, so a failed write goes ahead unrecorded"; D11 "a schedule, confirmation or other start goes ahead unrecorded"; D12 startRecorded]', async () => {
  await cases([
    { name: 'a write that fails (ENOSPC)', set: (ctx) => ctx.world.record.failWrites('ENOSPC'), recorded: false },
    { name: 'a record that gives a read error', set: (ctx) => ctx.world.record.failReads('EIO'), recorded: false },
    { name: 'a healthy record', set: () => {}, recorded: true },
  ], (c) => withCtl('D11', { world: { record: { record: seededRecord() } } }, async (ctx) => {
    const M = T0 - MIN;
    c.set(ctx);
    const sid = ctx.q.plantScheduled({ millis: M, every: EVERY });
    const v = await gateCall('beforeAcquire', pick1(ctx, sid), ctx.ctl);
    const p = [];
    if (v !== 'go') p.push(`the scheduled run should go ahead; beforeAcquire answered ${show(v)}`);
    const e = entryOf(ctx, sid);
    if (c.recorded) p.push(...entryProblems(ctx, sid, { jobId: sid, start: { at: iso(M), who: { ...WHO.schedule } } }, 'the schedule\'s start'));
    else if (e && e.start) p.push(`the record should hold no start for ${sid}; its entry is ${show(e)}`);
    const it = busyItem((await statusOf(ctx, 'signed-out', 'D12')).control, sid);
    if (!it) p.push(`the status should list ${sid} as busy`);
    else if (it.startRecorded !== c.recorded) p.push(`its busy item should read startRecorded: ${c.recorded}; it is ${show(it)}`);
    report(p, 'D12');
  }));
});

test('CT56: a damaged record (text that will not parse) is renamed aside — its bytes kept — before a fresh record is written holding only the new action, for a Run and for a Stop [ADR 0006 D11 "A damaged file is renamed to record.json.damaged-<iso> before a fresh record is written"]', async () => {
  await cases([
    { name: 'a Run', act: async (ctx) => [await runA(ctx)] },
    { name: 'a Stop', act: async (ctx) => { const k = await addJob(ctx, H.lineUpKey(610)); expectStopped(await stop(ctx, WHO.admin, [{ key: k, state: 'waiting' }]), [{ key: k, how: 'taken-out-of-line' }], true); return [k]; } },
  ], (c) => withCtl('D11', { world: { record: { text: '{not json' } } }, async (ctx) => {
    const keys = await c.act(ctx);
    const r = recordOf(ctx);
    const ren = seqs(ctx, 'renameRecord');
    const wr = seqs(ctx, 'writeRecord');
    const p = [];
    if (ren.length !== 1) p.push(`the damaged file should be renamed aside once; renameRecord was called ${ren.length} time(s)`);
    else if (!(wr.length && ren[0] < wr[0])) p.push('it should be renamed before the fresh record is written');
    if (!ctx.world.record.damaged.some((d) => d.text === '{not json')) p.push('the damaged bytes should be kept');
    if (!r || r.version !== 1 || exact(Object.keys(r.passes || {})) !== exact(keys) || (r.history || []).length !== 1) p.push(`a fresh record holding only ${show(keys)} expected; it is ${show(r)}`);
    report(p, 'D11');
  }));
});

test('CT57: with no record deps injected, the controller keeps its record at <stateDir>/control/record.json on a real temp directory — the directory 0700 and the file 0600; a file that will not parse is renamed to record.json.damaged-<…> with its bytes kept beside a fresh record; a record path that cannot be read refuses a Run with record-unavailable and is left as it was [ADR 0006 D11 "Where and how it is written", "Writing around a bad file"; § Seams "Store tests … Use a temp TAGGING_EDGES_STATE_DIR"]', async () => {
  const OMIT = { omit: ['readRecord', 'writeRecord', 'renameRecord'] };
  const p = [];
  for (const c of ['fresh', 'damaged', 'unreadable']) {
    const tmp = H.makeTempStateDir(`ct57-${c}`);
    const restoreEnv = tmp.useAsEnv();
    try {
      if (c !== 'fresh') fs.mkdirSync(tmp.controlDir, { recursive: true, mode: 0o700 });
      if (c === 'damaged') fs.writeFileSync(tmp.recordFile, '{not json', { mode: 0o600 });
      if (c === 'unreadable') fs.mkdirSync(tmp.recordFile);
      await withCtl('D11', { ...OMIT, world: { stateDir: tmp.dir } }, async (ctx) => {
        if (c === 'unreadable') {
          p.push(...codeProblems(await lineUp(ctx, WHO.owner), 'record-unavailable', 500).map((x) => `${c}: ${x}`));
          if (!fs.statSync(tmp.recordFile).isDirectory()) p.push(`${c}: the unreadable path was changed`);
          if (ctx.q.jobs().length) p.push(`${c}: nothing may be added`);
          return;
        }
        const key = await runA(ctx);
        const mode = (f) => (fs.statSync(f).mode & 0o777).toString(8);
        if (mode(tmp.controlDir) !== '700') p.push(`${c}: the control directory should be 0700; it is 0${mode(tmp.controlDir)}`);
        if (mode(tmp.recordFile) !== '600') p.push(`${c}: record.json should be 0600; it is 0${mode(tmp.recordFile)}`);
        let r = null;
        try { r = JSON.parse(fs.readFileSync(tmp.recordFile, 'utf8')); } catch (e) { p.push(`${c}: record.json does not parse: ${firstLine(e)}`); }
        if (r && !(r.version === 1 && r.passes && r.passes[key] && r.passes[key].start && exact(r.passes[key].start.who) === exact(WHO.owner))) p.push(`${c}: record.json should hold the owner's start for ${key}; it is ${show(r)}`);
        if (c === 'damaged') {
          const aside = fs.readdirSync(tmp.controlDir).filter((f) => f.startsWith('record.json.damaged-'));
          if (aside.length !== 1) p.push(`${c}: one record.json.damaged-<…> file expected; the directory holds ${show(fs.readdirSync(tmp.controlDir))}`);
          else if (fs.readFileSync(path.join(tmp.controlDir, aside[0]), 'utf8') !== '{not json') p.push(`${c}: the damaged bytes should be kept`);
        }
      });
    } catch (e) {
      p.push(`${c}: ${firstLine(e)}`);
    } finally {
      restoreEnv();
      tmp.cleanup();
    }
  }
  report(p, 'D11');
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT58–CT62 — the public status's control member (D12), through the real handleStatus
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT58: the status carries control: { queue, busy, gaveUp } with each busy item\'s key, jobId, state, since, behind, runId, stopAskedAt, startRecorded and confirmation, and no other member in either; every time is an ISO string; there is no who; it is the same for a signed-out reader and the owner; startRecorded is true for a Run\'s start and false for a due scheduled run not yet picked up and a job added another way [ADR 0006 D12; story AC-2 "Every viewer sees the same", "The public status … never says who"; AC-5]', async () => {
  await withCtl('D12', async (ctx) => {
    const k = await runA(ctx);
    await runPass(ctx, k);
    ctx.world.clock.advance(SEC);
    await stop(ctx, WHO.admin, [{ key: k, state: 'running' }]);
    ctx.world.clock.advance(MIN);
    const sid = ctx.q.plantScheduled({ millis: T0 + 30 * SEC, every: EVERY });
    await ctx.q.add(TASK, H.lineUpData(), { removeOnComplete: true, removeOnFail: true });
    const other = ctx.q.ids('wait').concat(ctx.q.ids('delayed')).find((id) => id !== sid);
    const out = await statusOf(ctx, 'signed-out');
    const owner = await statusOf(ctx, 'owner');
    const c = out.control;
    const p = [];
    if (c.queue !== 'ok') p.push(`queue should be 'ok'; it is ${show(c.queue)}`);
    if (!has(c, 'gaveUp')) p.push('control should carry gaveUp (null here)');
    for (const it of c.busy) {
      for (const f of ['key', 'state', 'since', 'startRecorded']) if (!has(it, f)) p.push(`${it.key}: the item lacks ${f}`);
      if (!ISO_RE.test(String(it.since))) p.push(`${it.key}: since should be an ISO string; it is ${show(it.since)}`);
      if (it.stopAskedAt != null && !ISO_RE.test(String(it.stopAskedAt))) p.push(`${it.key}: stopAskedAt should be an ISO string; it is ${show(it.stopAskedAt)}`);
    }
    const want = [
      { key: k, jobId: k, state: 'running', stopAskedAt: iso(T0 + SEC), startRecorded: true },
      { key: sid, jobId: sid, state: 'waiting', since: iso(T0 + 30 * SEC), behind: 'pass', startRecorded: false },
      { key: other, state: 'waiting', behind: 'pass', startRecorded: false },
    ];
    p.push(...itemsProblems(c.busy, want));
    for (const w of want) { const it = busyItem(c, w.key); if (it && it.stopAskedAt != null && w.stopAskedAt && it.stopAskedAt !== w.stopAskedAt) p.push(`${w.key}: stopAskedAt should read ${w.stopAskedAt}`); }
    const leaks = whoLeaks(c);
    if (leaks.length) p.push(`control carries who: ${leaks.join(', ')}`);
    p.push(...controlKeyProblems(c, 'the signed-out status'));
    if (exact(owner.control) !== exact(c)) p.push(`the owner and a signed-out reader should see the same control; the owner sees ${show(owner.control)}`);
    report(p, 'D12');
  });
});

/** control with the members that differ between any two passes, whoever started them, set aside. */
function normalisedControl(control) {
  return JSON.parse(JSON.stringify(control), (k, v) => (['key', 'jobId', 'since', 'runId'].includes(k) && v != null ? `<${k}>` : v));
}

test('CT58b: who stays indistinguishable to a signed-out reader — a pass lined up by the owner\'s Run, an admin\'s Run, a direct local call and the owner\'s confirmation (each in its own world) gives byte-identical control members once key, jobId, since and runId are set aside, each with no who and no member outside D12\'s sets; and so does a running pass whose stop the owner asked for beside one whose stop an admin asked for [ADR 0006 § Constraints "Those four stay indistinguishable to a signed-out reader"; D12 "a control member, with no who"; story AC-2 "The public status … never says who"; AC-5 "Who may read it"]', async () => {
  const p = [];
  const compare = async (label, runs) => {
    const seen = [];
    for (const c of runs) {
      await withCtl('D12', async (ctx) => {
        const k = await c.go(ctx);
        const { control } = await statusOf(ctx, 'signed-out', 'D12');
        const it = busyItem(control, k);
        if (!it) p.push(`${c.name}: the status should list ${k}; control is ${show(control)}`);
        else if (c.check) p.push(...c.check(it).map((x) => `${c.name}: ${x}`));
        const leaks = whoLeaks(control);
        if (leaks.length) p.push(`${c.name}: control carries who: ${leaks.join(', ')}`);
        p.push(...controlKeyProblems(control, c.name));
        seen.push({ name: c.name, text: exact(normalisedControl(control)) });
      });
    }
    for (const s of seen.slice(1)) {
      if (s.text !== seen[0].text) p.push(`${label}: ${s.name} and ${seen[0].name} should read the same; they read ${s.text} and ${seen[0].text}`);
    }
  };
  await compare('who started it', [
    { name: 'the owner\'s Run', go: (ctx) => runA(ctx, WHO.owner) },
    { name: 'an admin\'s Run', go: (ctx) => runA(ctx, WHO.admin) },
    { name: 'a direct local call', go: (ctx) => runA(ctx, WHO.local) },
    {
      name: 'the owner\'s confirmation',
      go: async (ctx) => {
        const a = await lineUp(ctx, WHO.confirmation, 'confirm');
        assert(enqueuedOf(a) && a.body.joined !== true, `setup: the confirm route's start with nothing busy should line up a new job (${adr('D8')}); it answered ${show(a.body)}`);
        return jobIdOfAnswer(a);
      },
    },
  ]);
  const stoppedBy = (who) => async (ctx) => {
    const k = await runA(ctx, WHO.owner);
    await runPass(ctx, k);
    ctx.world.clock.advance(SEC);
    expectStopped(await stop(ctx, who, [{ key: k, state: 'running' }]), [{ key: k, how: 'asked-to-stop' }], true, 'D9');
    return k;
  };
  const asked = (it) => (it.state === 'running' && ms(it.stopAskedAt) === T0 + SEC ? [] : [`the item should be running with stopAskedAt ${iso(T0 + SEC)}; it is ${show(it)}`]);
  await compare('who stopped it', [
    { name: 'a stop the owner asked for', go: stoppedBy(WHO.owner), check: asked },
    { name: 'a stop an admin asked for', go: stoppedBy(WHO.admin), check: asked },
  ]);
  report(p, 'D12');
});

test('CT59: a running item\'s confirmation reads \'taken-up\' when claimed/ holds a <runId>-*.json entry or the report says confirmation.found, \'cannot-tell\' when a confirmation is pending and the pass has no run yet or its phases do not yet include graph-read, otherwise null; a waiting item carries none [ADR 0006 D12 "confirmation is set only on a running item"; story AC-3 "if the running pass has taken up the confirmation, or the panel cannot yet tell"]', async () => {
  const pending = () => H.confirmationRecord();
  await cases([
    { name: 'nothing pending, through graph-read', conf: null, through: 'graph-read', want: null },
    { name: 'pending, through schema (a claim may be in progress)', conf: pending, through: 'schema', want: 'cannot-tell' },
    { name: 'pending, no phase yet', conf: pending, through: null, want: 'cannot-tell' },
    { name: 'pending, through graph-read (for the next pass)', conf: pending, through: 'graph-read', want: null },
    { name: 'claimed/ holds its entry', conf: pending, through: 'graph-read', claim: true, want: 'taken-up' },
    { name: 'the report says found', conf: null, through: 'graph-read', found: true, want: 'taken-up' },
    { name: 'starting, pending', conf: pending, starting: true, want: 'cannot-tell' },
    { name: 'starting, nothing pending', conf: null, starting: true, want: null },
    { name: 'waiting, pending', conf: pending, waiting: true, want: null },
  ], (c) => withCtl('D12', { world: { confirmation: c.conf ? c.conf() : null } }, async (ctx) => {
    const k = await runA(ctx);
    if (c.starting) await launch(ctx, k);
    else if (!c.waiting) {
      const { rec } = await runPass(ctx, k, c.through ? { through: c.through, confirmation: c.found ? { found: true } : undefined } : {});
      if (c.claim) ctx.world.claim(rec.runId);
    }
    const it = busyItem((await statusOf(ctx)).control, k);
    assert(it, `${k} should be busy`);
    report([(c.want == null ? it.confirmation != null : it.confirmation !== c.want) && `confirmation should be ${show(c.want)}; it is ${show(it.confirmation)}`], 'D12');
  }));
});

test('CT60: the confirmation verdict reads confirmation.json, then report.json, then listClaimed(runId), so a claim landing between any two of these reads is seen as \'taken-up\' or \'cannot-tell\', never null — between the confirmation and the report (the claim\'s save landed or not), and between the report and the claimed/ listing [ADR 0006 D12 "Read order for this verdict"; § Seams "A claim lands between each pair of the D12 verdict\'s reads"]', async () => {
  await cases([
    { name: 'between confirmation.json and report.json, its save not yet landed', hook: 'readConfirmation', save: false },
    { name: 'between confirmation.json and report.json, its save landed', hook: 'readConfirmation', save: true },
    { name: 'between report.json and the claimed/ listing', hook: 'readReport', save: true },
  ], (c) => withCtl('D12', { world: { confirmation: H.confirmationRecord() } }, async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k, { through: 'schema' });
    ctx.hooks.after[c.hook] = once(() => ctx.world.claim(rec.runId, { save: c.save }));
    const it = busyItem((await statusOf(ctx)).control, k);
    report([!it && `${k} should be busy`, it && !['taken-up', 'cannot-tell'].includes(it.confirmation) && `confirmation should be 'taken-up' or 'cannot-tell'; it is ${show(it.confirmation)}`], 'D12');
  }));
});

test('CT61: a waiting pass that gives up after its 4 h wait shows control.gaveUp { key, at } — while a due scheduled run waits behind it and after, whatever else is busy — and its record keeps the start with gaveUpAt; after a restart it comes from the record; once a later pass has started it is null [ADR 0006 D12 "gaveUp"; D3 gaveUp; story AC-2 "A waiting pass that gives up … the history keeps its start"; § Seams "A pass gives up while a due scheduled run waits behind it, and the gave-up line still shows"]', async () => {
  await withCtl('D12', async (ctx) => {
    const k = await runA(ctx);
    const job = await heavyWait(ctx, k);
    ctx.world.clock.advance(2 * MIN);
    const sid = ctx.q.plantScheduled({ millis: T0 + MIN, every: EVERY });
    ctx.world.clock.advance(4 * HOUR);
    const at = iso(ctx.world.clock.now());
    await within(ctx.ctl.gate.gaveUp(job, Object.assign(new Error('gave up'), { code: WAIT_TIMEOUT })), 3000, 'gate.gaveUp');
    const p = [];
    let c = (await statusOf(ctx)).control;
    if (exact(c.gaveUp) !== exact({ key: k, at })) p.push(`while the job still ends: gaveUp should be ${show({ key: k, at })}; it is ${show(c.gaveUp)}`);
    ctx.ctl.gate.ended(job);
    ctx.q.fail(k, new Error('gave up'));
    c = (await statusOf(ctx)).control;
    if (exact(c.gaveUp) !== exact({ key: k, at })) p.push(`with the scheduled run waiting: gaveUp should be ${show({ key: k, at })}; it is ${show(c.gaveUp)}`);
    p.push(...itemsProblems(c.busy, [{ key: sid, state: 'waiting', behind: null }]));
    p.push(...entryProblems(ctx, k, { start: { at: iso(T0), who: { ...WHO.owner } }, gaveUpAt: at }, 'the give-up'));
    const ctl2 = restart(ctx);
    const c2 = (await statusOf(ctx, 'signed-out', 'D12', ctl2)).control;
    if (exact(c2.gaveUp) !== exact({ key: k, at })) p.push(`after a restart: gaveUp should come from the record, ${show({ key: k, at })}; it is ${show(c2.gaveUp)}`);
    ctx.world.clock.advance(MIN);
    await runPass(ctx, sid, {}, ctl2);
    const c3 = (await statusOf(ctx, 'signed-out', 'D12', ctl2)).control;
    if (c3.gaveUp != null) p.push(`once a later pass started, gaveUp should be null; it is ${show(c3.gaveUp)}`);
    report(p, 'D12');
  });
});

test('CT62: a queue read that fails leaves the status served (200, the report whole) with control.queue \'read-failed\' and the live pass still listed — never a 500, never "nothing waiting" [ADR 0006 D12 "A failed queue read leaves the report served, with queue: \'read-failed\', never a 500"; § Constraints "The public status now depends on Redis"; story AC-2 "When the server cannot tell"]', async () => {
  await withCtl('D12', async (ctx) => {
    const k = await runA(ctx);
    const { rec } = await runPass(ctx, k);
    await addJob(ctx, H.lineUpKey(700));
    ctx.q.inject('getDelayed', { error: 'ECONNRESET', times: 10 });
    const { body, control } = await statusOf(ctx);
    report([control.queue !== 'read-failed' && `queue should be 'read-failed'; it is ${show(control.queue)}`,
      !(body.latest && body.latest.runId === rec.runId) && 'the report should still be served',
      ...itemsProblems(control.busy, [{ key: k, state: 'running' }])], 'D12');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// CT63–CT64 — nothing else moves (AC-6), and the backstop's next run (AC-3)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('CT63: Run and Stop change no schedule entry and not the real-time path\'s switch — across a Run, a Stop of a waiting pass, a Stop of a running one, a Stop of a due scheduled run and a refused Stop (nothing to stop), each answered as it should be, with the fake queue\'s whole surface in reach (remove and the job-scheduler calls): the queue sees only reads and adds, the scheduler keeps its entry, template and next run, the due run stays in the queue, and the Scheduled Tasks entries file and realtime/switch.json and switch-history.json under both state directories are unchanged byte for byte [story AC-6 "They do not change any schedule entry or the real-time path\'s switch"; AC-3 "A stop never changes any schedule entry"; Test tasks "after a Run and after a Stop, the schedule entries and the path\'s switch unchanged"; ADR 0006 D9; § Constraints "schedules never change", "The real-time path is not touched"]', async () => {
  const schedFile = process.env.SCHEDULED_TASKS_CONFIG_PATH;
  assert(typeof schedFile === 'string' && path.isAbsolute(schedFile) && !schedFile.startsWith('/var/lib/brainstorm'),
    `setup: run() should point SCHEDULED_TASKS_CONFIG_PATH at a temp file before anything loads; it is ${show(schedFile)}`);
  const runDir = process.env.TAGGING_EDGES_STATE_DIR;
  await withCtl('D9', { fullQueue: true }, async (ctx) => {
    const dirs = [...new Set([runDir, ctx.world.stateDirPath()].filter(Boolean))];
    try {
      fs.writeFileSync(schedFile, scheduledTasksText());
      for (const d of dirs) seedRealtimeSwitch(d);
      const realtimeDirs = dirs.map((d) => path.join(d, 'realtime'));
      const filesBefore = filesSnapshot([schedFile], realtimeDirs);
      assert(typeof ctx.deps.queue.removeJobScheduler === 'function' && typeof ctx.deps.queue.upsertJobScheduler === 'function' && typeof ctx.deps.queue.remove === 'function',
        'setup: the controller\'s queue should reach the fake\'s whole surface (remove, upsertJobScheduler, removeJobScheduler)');
      const sid = ctx.q.plantScheduled({ millis: T0 + HOUR, every: EVERY });
      const before = ctx.q.scheduler(SCHED_ENTRY);
      const k1 = await runA(ctx);
      expectStopped(await stop(ctx, WHO.admin, [{ key: k1, state: 'waiting' }]), [{ key: k1, how: 'taken-out-of-line' }], true, 'D9');
      const j1 = pick1(ctx, k1);
      await gateCall('beforeAcquire', j1, ctx.ctl, 'skip');
      ctx.q.complete(j1.id, ctx.ctl.gate.skipped(j1));
      ctx.ctl.gate.ended(j1);
      const k2 = await runA(ctx);
      await runPass(ctx, k2);
      expectStopped(await stop(ctx, WHO.admin, [{ key: k2, state: 'running' }]), [{ key: k2, how: 'asked-to-stop' }], true, 'D9');
      ctx.world.endPass({ state: 'stopped' });
      ctx.world.clock.advance(2 * HOUR);
      expectStopped(await stop(ctx, WHO.owner, [{ key: sid, state: 'waiting' }]), [{ key: sid, how: 'taken-out-of-line' }], true, 'D9');
      expectCode(await stop(ctx, WHO.admin, [{ key: sid, state: 'waiting' }]), 'nothing-to-stop', 409, 'D9');
      const after = ctx.q.scheduler(SCHED_ENTRY);
      const p = [];
      const changes = queueChanges(ctx);
      if (changes.length) p.push(`the queue should see only reads and adds; it also saw ${show(changes)}`);
      if (exact(after) !== exact(before)) p.push(`the scheduler should be unchanged: ${show(before)}; it is ${show(after)}`);
      if (!ctx.q.has(sid)) p.push('the due scheduled run was removed from the queue; it should stay until its pickup skips it');
      p.push(...filesProblems(filesBefore, filesSnapshot([schedFile], realtimeDirs), 'after the Run and the Stops'));
      report(p, 'D9');
    } finally {
      try { fs.rmSync(schedFile, { force: true }); } catch (_) { /* best effort */ }
      if (runDir) { try { fs.rmSync(path.join(runDir, 'realtime'), { recursive: true, force: true }); } catch (_) { /* best effort */ } }
    }
  });
});

test('CT64: a Stop never applies to the backstop\'s next scheduled run, whose time has not come — named alone it is refused 409 nothing-to-stop, recording and marking nothing (no record entry, its lock wait never abandoned); named beside a waiting pass, only that pass is taken out of line and the scheduled run gains no entry; once its time comes it is picked up and goes ahead [story AC-3 "It never applies to the backstop\'s next scheduled run, whose time has not come"; ADR 0006 D9 step 2 "A target missing from open … is left out. If none is left, answer 409 nothing-to-stop"; D5 "not-yet-due delayed jobs are ignored"]', async () => {
  await withCtl('D9', async (ctx) => {
    const sid = ctx.q.plantScheduled({ millis: T0 + HOUR, every: EVERY });
    const sjob = ctx.q.jobs().find((j) => j.id === sid);
    const writes = count(ctx, 'writeRecord');
    const a = await stop(ctx, WHO.admin, [{ key: sid, state: 'waiting' }]);
    const p = codeProblems(a, 'nothing-to-stop', 409).map((x) => `named alone: ${x}`);
    if (count(ctx, 'writeRecord') !== writes) p.push('named alone: a refused Stop recorded something');
    if (entryOf(ctx, sid) !== undefined) p.push(`named alone: the record should hold no entry for ${sid}; it holds ${show(entryOf(ctx, sid))}`);
    if (ctx.ctl.gate.shouldAbandon(sjob) !== false) p.push(`named alone: ${sid} may not be marked; shouldAbandon answered ${show(ctx.ctl.gate.shouldAbandon(sjob))}`);
    if (count(ctx, 'kill') !== 0) p.push('named alone: a refused Stop sent a signal');
    report(p, 'D9');
  });
  await withCtl('D9', async (ctx) => {
    const sid = ctx.q.plantScheduled({ millis: T0 + HOUR, every: EVERY });
    const k = await runA(ctx);
    const a = await stop(ctx, WHO.admin, [{ key: k, state: 'waiting' }, { key: sid, state: 'waiting' }]);
    expectStopped(a, [{ key: k, how: 'taken-out-of-line' }], true, 'D9');
    const p = [];
    if (entryOf(ctx, sid) !== undefined) p.push(`beside a waiting pass: the record should hold no entry for ${sid}; it holds ${show(entryOf(ctx, sid))}`);
    ctx.world.clock.advance(HOUR + MIN);
    const j = pick1(ctx, k);
    await gateCall('beforeAcquire', j, ctx.ctl, 'skip');
    ctx.q.complete(j.id, ctx.ctl.gate.skipped(j));
    ctx.ctl.gate.ended(j);
    const v = await gateCall('beforeAcquire', pick1(ctx, sid), ctx.ctl);
    if (v !== 'go') p.push(`once its time came, the scheduled run should go ahead; beforeAcquire answered ${show(v)}`);
    report(p, 'D9');
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
async function run() {
  console.log('\n--- tagging-edges pass controller tests (epic tagging-edges, Story 6 — ADR 0006 D1, D2, D5, D6, D8, D9, D11, D12, D14; AC-1–AC-6) ---');
  let pass = 0;
  let fail = 0;
  const failures = [];
  const savedDir = process.env.TAGGING_EDGES_STATE_DIR;
  const root = H.makeTempStateDir('ct-suite');
  const schedDir = H.makeTempStateDir('ct-scheduled-tasks');
  const restoreLogging = H.structuredLoggingOff();
  const restoreSchedule = useScheduledTasksConfig(path.join(schedDir.dir, 'scheduled-tasks.json'));
  const guard = H.guardProcessKill({ label: 'the CT suite' });
  const strays = [];
  const onUnhandled = (reason) => { strays.push(`unhandled rejection: ${firstLine(reason)}`); };
  process.on('unhandledRejection', onUnhandled);
  try {
    process.env.TAGGING_EDGES_STATE_DIR = root.dir;
    for (const [name, fn] of tests) {
      strays.length = 0;
      const killsBefore = guard.directKills.length;
      let err = null;
      try { await fn(); } catch (e) { err = e; }
      await new Promise((r) => { setImmediate(r); });
      if (!err && strays.length) err = new Error(`the test left ${strays.length} unhandled rejection(s): ${strays.join('; ')}`);
      if (!err && guard.directKills.length > killsBefore) {
        err = new Error(`the code under test called process.kill directly (${show(guard.directKills.slice(killsBefore))}); a signal goes only through the injected kill(pid, signal) dep (${adr('D9')}; § Seams deps list)`);
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
    guard.restore();
    restoreSchedule();
    restoreLogging();
    if (savedDir === undefined) delete process.env.TAGGING_EDGES_STATE_DIR; else process.env.TAGGING_EDGES_STATE_DIR = savedDir;
    root.cleanup();
    schedDir.cleanup();
  }
  console.log(`\ntagging-edges-pass-control: ${pass} passed, ${fail} failed, 0 skipped`);
  return { pass, fail, skipped: 0, failures };
}

if (require.main === module) {
  run().then(({ fail }) => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
