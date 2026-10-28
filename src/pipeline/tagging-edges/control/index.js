/**
 * The gap-filling pass's controller (tagging-edges story 6, ADR tagging-edges/0006 D1, D2, D5, D6, D8, D9, D11).
 *
 * One instance per process, `controller` (built from defaultDeps), shared by the routes and the task queue's worker
 * (jobGates.gateFor). It decides, in one promise chain and one order, every moment of a pass the story names:
 *   lineUp({ who, mode })     a start. mode 'run' (Run and the run-task route, D6) is refused while anything is busy;
 *                             mode 'confirm' (the confirm route's enqueue, D8) joins a busy pass that has no stop asked
 *                             for. Each start adds a job under a new, opaque id reconcileTaggingEdges-<12 hex>, so
 *                             nothing ever joins in BullMQ
 *   stop({ who, targets })    a Stop of exactly what its prompt showed (D9): a waiting pass is taken out of line, a
 *                             running one is sent SIGTERM at its own pid, checked against its job and start just before
 *   snapshot({ fresh })       what is busy (D5): report.json's live pass first, then up to four queue reads under one
 *                             deadline; a read that fails or times out is "cannot tell", never "nothing there". Without
 *                             fresh, a snapshot from the last second of the same generation is reused (the status route)
 *   gate                      the worker's per-job decisions (gate.js, D3)
 * Each answer of lineUp and stop is { status, body } and never rejects. Who, the body and the queue being off are the
 * routes' refusals; nothing here reads a session.
 *
 * The in-memory marks are mirrored to a private record of who started and stopped each pass (store.js, D11): a Stop
 * takes effect in memory first, so it works when the record cannot be written; a Run is refused then. Who is never
 * logged, never put in job data, and never on a snapshot.
 *
 * Nothing happens at load: no disk, no Redis. The queue module and the state helpers are reached only when a default
 * dep is called, so queue/index.js can require the gate at init without a cycle. Tests build their own instance with
 * createController(deps) (§ Seams): a dep left out falls back to its default, the record deps to the store under
 * deps.stateDir().
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeGate } = require('./gate');
const { createStore } = require('./store');

const TASK_NAME = 'reconcileTaggingEdges';
const LEGACY_ID = TASK_NAME;
const LINEUP_ID = /^reconcileTaggingEdges-[0-9a-f]{12}$/;
const JOB_ID_RE = /^[A-Za-z0-9:._@-]{1,200}$/; // the job ids the pass writes into its report (D10)
const SCHED_PREFIX = 'repeat:sched:';
const WAITING_TYPES = ['waiting', 'paused', 'prioritized'];
const TIMERS = Object.freeze({ stepMs: 2000, pidWaitMs: 3000, pidPollMs: 100, endedKeysMs: 10000 });
const STATUS_REUSE_MS = 1000;
const HISTORY_CAP = 10;
const PASSES_CAP = 40;

const passState = () => require('../state');
const taskQueue = () => require('../../../manage/taskQueue/queue');
const allowErrorCode = (code) => require('../../../lib/tagging-edges/realtime').allowErrorCode(code);

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A record entry under `key` only when it is the object's own: a job id such as "__proto__" names no prototype. */
const entryAt = (passes, key) => (Object.prototype.hasOwnProperty.call(passes, key) && isObject(passes[key]) ? passes[key] : null);
const msOf =(v) => (typeof v === 'number' ? v : Date.parse(v));
const iso = (ms) => new Date(ms).toISOString();
/** An ISO string, or null for a time a Date cannot hold (not finite, or past its range), so it never throws. */
const toIso = (v) => { const t = new Date(msOf(v)); return Number.isNaN(t.getTime()) ? null : t.toISOString(); };
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const emptyRecord = () => ({ version: 1, passes: {}, history: [] });

// ─── job ids and keys (D2) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * A job's key: its id, or `<id>@<timestamp>` for the legacy fixed id, which is reused (a stalled re-run keeps it).
 * Every comparison with a report's job.id uses the busy item's own jobId, never the key.
 */
function keyOf(job) {
  const id = String(job.id);
  return id === LEGACY_ID ? `${id}@${job.timestamp}` : id;
}
const isScheduled = (id) => String(id).startsWith(SCHED_PREFIX);
/** The digits after a scheduled id's last ':' (the entry id may itself contain ':'), or null. */
function millisOf(id) {
  const m = /:(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
}
/** When a job was asked for: a scheduled run's millis, else its timestamp. */
function askedAt(job) {
  const millis = isScheduled(job.id) ? millisOf(job.id) : null;
  return millis === null ? job.timestamp : millis;
}

/** who as the record keeps it: { kind }, with an 8-character key for the owner or an admin only (D11). */
function normalWho(who) {
  const kind = isObject(who) && typeof who.kind === 'string' ? who.kind : 'other';
  if (kind === 'owner' || kind === 'admin') return { kind, key: String(who.key || who.pubkey || '').slice(0, 8) };
  return { kind };
}

const timedOut = () => Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', timedOut: true });
/** fn() raced against `ms`; a call that settles after its deadline is ignored. No time left: fn is never called. */
function bounded(fn, ms) {
  if (!(ms > 0)) return Promise.reject(timedOut());
  const call = Promise.resolve().then(fn);
  call.catch(() => {});
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => reject(timedOut()), ms); });
  return Promise.race([call, deadline]).finally(() => clearTimeout(timer));
}

// ─── deps ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The real dependencies, each reached only when called, so this module loads stack-free. */
function defaultDeps() {
  const passQueue = () => taskQueue().getQueue(TASK_NAME);
  return {
    now: () => Date.now(),
    randomKey: () => `${TASK_NAME}-${crypto.randomBytes(6).toString('hex')}`,
    stateDir: () => passState().stateDir(),
    readReport: () => passState().readReport(),
    readConfirmation: () => passState().readPendingConfirmation(),
    isAlive: (record) => passState().isAlive(record),
    listClaimed: (runId) => {
      let names;
      try {
        names = fs.readdirSync(path.join(passState().stateDir(), 'claimed'));
      } catch (err) {
        if (err && err.code === 'ENOENT') return [];
        throw err;
      }
      return names.filter((n) => n.startsWith(`${runId}-`)).sort();
    },
    queueHealth: () => taskQueue().queueHealth(),
    queue: {
      getActive: () => passQueue().getActive(),
      getDelayed: () => passQueue().getDelayed(),
      getJobs: (types) => passQueue().getJobs(types),
      add: (name, data, opts) => passQueue().add(name, data, opts),
    },
    kill: (pid, signal) => process.kill(pid, signal),
    taskTimeoutMs: () => {
      const registry = require('../../../manage/taskQueue/taskRegistry.json');
      const { resolveTaskTimeout } = require('../../../utils/taskTimeout');
      return resolveTaskTimeout(registry.tasks[TASK_NAME], registry).timeoutMs;
    },
    timers: TIMERS,
  };
}

/** The given deps over the defaults; the record deps fall back to the store under the instance's own stateDir(). */
function withDeps(deps) {
  const given = isObject(deps) ? deps : {};
  const d = defaultDeps();
  for (const [k, v] of Object.entries(given)) if (v !== undefined) d[k] = v;
  d.timers = { ...TIMERS, ...(isObject(given.timers) ? given.timers : {}) };
  const store = () => createStore({ dir: path.join(d.stateDir(), 'control') });
  if (typeof given.readRecord !== 'function') d.readRecord = () => store().read();
  if (typeof given.writeRecord !== 'function') d.writeRecord = (record) => store().write(record);
  if (typeof given.renameRecord !== 'function') d.renameRecord = (at) => store().renameDamaged(at);
  return d;
}

// ─── the controller ──────────────────────────────────────────────────────────────────────────────────────────────

function createController(deps) {
  const d = withDeps(deps);
  // D1's in-memory state, keyed by the job key unless said otherwise.
  const s = {
    chain: Promise.resolve(),
    phases: new Map(), // key → { jobId, phase: 'waiting-for-lock' | 'launched', since }, written only by the gate
    endedKeys: new Map(), // key → endedAt, filled by gate.ended
    skips: new Set(), // waiting jobs taken out of line
    noRerun: new Set(), // jobs whose running pass was asked to stop
    stopsAsked: new Map(), // key → { at, runId }
    linedUp: new Set(), // every key lineUp added or tried to add
    lastGaveUp: null, // { key, at }
    record: emptyRecord(), // the last record read or written
    recordState: null, // null (not read yet) | 'empty' | 'recorded' | 'unreadable' | 'damaged'
    readError: null,
    generation: 0,
    lastRead: null, // the last queue read, for pruning: { ok: true, ids } | { ok: false }
    lastBusy: [], // the keys busy at the last snapshot, for pruning
    cache: null, // the status route's snapshot: { gen, at, pending, promise }
  };

  /** One step of the chain: the steps run one at a time, and one that fails never breaks it. */
  function step(fn) {
    const run = s.chain.then(fn);
    s.chain = run.catch(() => {});
    return run;
  }
  const bump = () => { s.generation += 1; };
  const answer = (status, body) => ({ status, body });
  const queueUnavailable = () => answer(503, { success: false, code: 'QUEUE_UNAVAILABLE' });
  const entryOf = (key) => entryAt(s.record.passes, key);
  const endedRecently = (key) => {
    const at = s.endedKeys.get(key);
    return at !== undefined && d.now() - at < d.timers.endedKeysMs;
  };
  const latestOf = (report) => (isObject(report) && isObject(report.latest) ? report.latest : null);
  async function latestRun() {
    try { return latestOf(await d.readReport()); } catch (_) { return null; }
  }
  async function aliveOf(record) {
    try { return !!(await d.isAlive(record)); } catch (_) { return false; }
  }

  // ─── the record (D11) ──────────────────────────────────────────────────────────────────────────────────────────

  async function readRecord() {
    let r;
    try { r = await d.readRecord(); } catch (err) { r = { unreadable: true, readError: (err && err.code) || 'error' }; }
    if (r === null || r === undefined) {
      s.record = emptyRecord();
      s.recordState = 'empty';
    } else if (r.unreadable) {
      s.recordState = 'unreadable';
      s.readError = r.readError || 'error';
    } else if (r.damaged || r.version !== 1 || !isObject(r.passes) || !Array.isArray(r.history)) {
      s.record = emptyRecord();
      s.recordState = 'damaged';
    } else {
      s.record = r;
      s.recordState = 'recorded';
    }
  }
  /** Read the record on first use, and again while its last read was not readable. */
  async function loadRecord() {
    if (s.recordState === null || s.recordState === 'unreadable' || s.recordState === 'damaged') await readRecord();
  }

  /**
   * passes keeps, up to 40, the keys still busy, the keys the history names and the entries joined to a run in
   * report.json: by the run's job id, or by its runId on the entry's stop (as the panel joins a stop, so a stopped
   * hand run's `run:` entry, whose jobId is null, keeps who stopped it). Beyond that, every skip or noRerun entry whose
   * job the last queue read still found (all of them when that read failed or none has happened yet).
   */
  async function prune(r, keys) {
    let report;
    try { report = await d.readReport(); } catch (_) { return; } // cannot tell which entries a run joins: keep them
    const runs = (isObject(report) ? [report.latest, ...(Array.isArray(report.previous) ? report.previous : [])] : []).filter(isObject);
    const runJobIds = new Set(runs.filter((x) => isObject(x.job) && x.job.id != null).map((x) => String(x.job.id)));
    const runIds = new Set(runs.filter((x) => x.runId != null).map((x) => String(x.runId)));
    const joined = (e) => (e.jobId != null && runJobIds.has(String(e.jobId)))
      || (isObject(e.stop) && e.stop.runId != null && runIds.has(String(e.stop.runId)));
    const keep = new Set();
    const take = (k) => { if (keep.size < PASSES_CAP && entryAt(r.passes, k)) keep.add(k); };
    [...keys, ...s.lastBusy, ...s.phases.keys()].forEach(take);
    r.history.forEach((l) => take(l && l.key));
    for (const [k, e] of Object.entries(r.passes)) if (isObject(e) && joined(e)) take(k);
    const found = s.lastRead && s.lastRead.ok ? s.lastRead.ids : null;
    for (const [k, e] of Object.entries(r.passes)) {
      if (isObject(e) && (e.skip || e.noRerun) && (!found || found.has(String(e.jobId)))) keep.add(k);
    }
    r.passes = Object.fromEntries(Object.entries(r.passes).filter(([k]) => keep.has(k)));
  }

  /**
   * Write the record with `mutate` applied, inside the chain → { ok: true } | { ok: false, code }. While the record
   * gives a read error nothing writes it; a damaged file is renamed aside, its bytes kept, before a fresh record is
   * written. The in-memory record changes only when the write succeeds.
   */
  async function commit(mutate, keys) {
    await loadRecord();
    if (s.recordState === 'unreadable') return { ok: false, code: s.readError };
    if (s.recordState === 'damaged') {
      try { await d.renameRecord(iso(d.now())); } catch (err) { return { ok: false, code: err && err.code }; }
      s.record = emptyRecord();
      s.recordState = 'empty';
    }
    const next = JSON.parse(JSON.stringify(s.record));
    mutate(next);
    await prune(next, keys);
    try { await d.writeRecord(next); } catch (err) { return { ok: false, code: err && err.code }; }
    s.record = next;
    s.recordState = 'recorded';
    return { ok: true };
  }

  function entryIn(r, key, jobId) {
    if (!entryAt(r.passes, key)) {
      // Defined, never assigned: assigning under "__proto__" would write onto the prototype instead of an entry.
      const value = { jobId, start: null, stop: null, skip: false, noRerun: false, gaveUpAt: null };
      Object.defineProperty(r.passes, key, { value, enumerable: true, writable: true, configurable: true });
    }
    return r.passes[key];
  }
  /** history: newest first by `at` (a schedule's start can be written late, at its due time), at most 10. */
  function addLine(r, line) {
    r.history = [line, ...r.history].sort((a, b) => msOf(b && b.at) - msOf(a && a.at)).slice(0, HISTORY_CAP);
  }
  const startOf = (key, jobId, at, who) => (r) => {
    entryIn(r, key, jobId).start = { at, who };
    addLine(r, { action: 'start', key, at, who });
  };
  /** A lineUp start's write → commit's answer, plus `prior`: a copy of the record it was written over, for takeBack. */
  async function commitStart(key, at, who) {
    let prior = null;
    const wrote = await commit((r) => { prior = JSON.parse(JSON.stringify(r)); startOf(key, key, at, who)(r); }, [key]);
    return { ...wrote, prior };
  }
  /**
   * Take back a start whose add failed (D6 step 3, D8): the record as it was just before the start's own write, so its
   * entry and history line go, and the oldest line or entry that write's cap or pruning pushed out comes back. Nothing
   * else writes in between: both writes are one chain step.
   */
  const takeBack = (prior) => (r) => {
    r.passes = prior.passes;
    r.history = prior.history;
  };
  const recordStart = (key, jobId, atMs, who) => commit(startOf(key, jobId, toIso(atMs) || iso(d.now()), who), [key]);
  const recordGaveUp = (key, jobId, atMs) => commit((r) => { entryIn(r, key, jobId).gaveUpAt = iso(atMs); }, [key]);

  // ─── the busy snapshot (D5, and the data D12 serves) ───────────────────────────────────────────────────────────

  async function health() {
    let h;
    try { h = await d.queueHealth(); } catch (_) { h = 'not-ready'; }
    if (h === 'ready') return 'ok';
    return h === 'off' ? 'off' : 'not-ready';
  }

  /** Four reads under one deadline, each with what is left of it; the first that fails or times out ends them. */
  async function readQueue() {
    const jobs = new Map(); // id → { job, where }, the later read's state kept
    const reads = [
      ['active', () => d.queue.getActive()],
      ['delayed', () => d.queue.getDelayed()],
      ['waiting', () => d.queue.getJobs(WAITING_TYPES.slice())],
      ['active', () => d.queue.getActive()],
    ];
    const until = Date.now() + d.timers.stepMs;
    for (const [where, read] of reads) {
      let list;
      try { list = await bounded(read, until - Date.now()); } catch (_) { return { ok: false, jobs }; }
      for (const job of Array.isArray(list) ? list : []) if (job && job.id != null) jobs.set(String(job.id), { job, where });
    }
    return { ok: true, jobs };
  }

  async function compute() {
    const now = d.now();
    // 0. confirmation.json, for the confirmation verdict; read first, so a claim landing between reads is never null.
    let pending;
    try { pending = (await d.readConfirmation()) != null; } catch (_) { pending = true; }
    // 1. report.json, and the liveness of its latest run.
    const latest = latestOf(await d.readReport());
    const alive = !!latest && latest.endedAt == null && (await aliveOf(latest));
    // 2. the record, loaded on first use. The in-memory marks (phases, skips, noRerun, stopsAsked, endedKeys) are read
    // later, at classification, after the queue reads, so a gate step or a Stop that lands during those reads is seen.
    await loadRecord();
    // 3. the queue, while Redis is ready.
    let queue = await health();
    let jobs = new Map();
    if (queue === 'ok') {
      const read = await readQueue();
      jobs = read.jobs;
      if (!read.ok) queue = 'read-failed';
      s.lastRead = read.ok ? { ok: true, ids: new Set(jobs.keys()) } : { ok: false };
    }

    // Liveness comes first: a live latest is running, whatever the queue read found.
    const items = [];
    let live = null;
    let matchedId = null;
    if (alive) {
      const jobId = isObject(latest.job) && latest.job.id != null ? String(latest.job.id) : null;
      const started = msOf(latest.startedAt);
      const seen = jobId === null ? undefined : jobs.get(jobId);
      let key;
      if (seen && seen.where === 'active' && !(seen.job.processedOn > started)) { key = keyOf(seen.job); matchedId = jobId; }
      else if (jobId !== null && JOB_ID_RE.test(jobId) && jobId !== LEGACY_ID && !seen) key = jobId;
      else key = `run:${latest.runId}`;
      live = { key, jobId, state: 'running', since: started, behind: null, runId: latest.runId == null ? null : latest.runId };
      items.push(live);
    }

    // The other jobs, only when every read answered: "cannot tell" is never "nothing waiting".
    if (queue === 'ok') {
      const activeIds = [...jobs].filter(([, v]) => v.where === 'active').map(([id]) => id);
      const behindPass = (id) => (alive || activeIds.some((a) => a !== id) ? 'pass' : null);
      const hidden = (key) => { const e = entryOf(key); return s.skips.has(key) || s.noRerun.has(key) || !!(e && (e.skip || e.noRerun)); };
      const waiting = (job, key, behind) => ({ key, jobId: String(job.id), state: 'waiting', since: askedAt(job), behind, runId: null });
      for (const [id, { job, where }] of jobs) {
        if (id === matchedId) continue;
        const key = keyOf(job);
        if (hidden(key)) continue;
        if (where === 'delayed') {
          if ((Number(job.timestamp) || 0) + (Number(job.delay) || 0) <= now) items.push(waiting(job, key, behindPass(id)));
        } else if (where === 'waiting') {
          items.push(waiting(job, key, behindPass(id)));
        } else {
          const phase = s.phases.get(key);
          if (phase && phase.phase === 'waiting-for-lock') {
            items.push(waiting(job, key, 'heavy-work'));
          } else if (phase && phase.phase === 'launched') {
            // Its own run has ended while the job is still active: the finishing window, not busy.
            const ownRun = !!latest && isObject(latest.job) && String(latest.job.id) === String(job.id) && msOf(latest.startedAt) >= phase.since;
            const ending = (ownRun && (latest.endedAt != null || !alive)) || endedRecently(key);
            if (!ending) items.push({ key, jobId: String(job.id), state: 'running', since: phase.since, behind: null, runId: null });
          } else if (!endedRecently(key)) {
            // Not yet seen by this process's gate: a pickup whose beforeAcquire is queued, or a stalled job.
            items.push(waiting(job, key, null));
          }
        }
      }
    }

    for (const it of items) {
      it.stopAskedAt = stopAskedOf(it);
      it.startRecorded = !!(entryOf(it.key) && entryOf(it.key).start);
      it.confirmation = null;
      if (it.state !== 'running') continue;
      // 4. The confirmation verdict, from confirmation.json, report.json and then claimed/, in that order.
      let claimed = false;
      let unknown = false;
      if (it.runId) {
        try { const list = await d.listClaimed(it.runId); claimed = Array.isArray(list) && list.length > 0; } catch (_) { unknown = true; }
      }
      const run = it.runId && latest && latest.runId === it.runId ? latest : null;
      const found = !!run && isObject(run.confirmation) && run.confirmation.found === true;
      const pastClaim = !!run && Array.isArray(run.phases) && run.phases.some((p) => p && p.phase === 'graph-read');
      if (claimed || found) it.confirmation = 'taken-up';
      else if (unknown || (pending && !pastClaim)) it.confirmation = 'cannot-tell';
    }
    const order = (v) => (Number.isFinite(v) ? v : 0);
    items.sort((a, b) => (a.state === b.state ? order(a.since) - order(b.since) : (a.state === 'running' ? -1 : 1)));
    s.lastBusy = items.map((it) => it.key);

    // A give-up shows until a later pass has started.
    let gave = s.lastGaveUp;
    for (const [key, e] of Object.entries(s.record.passes)) {
      const at = isObject(e) ? msOf(e.gaveUpAt) : NaN;
      if (Number.isFinite(at) && (!gave || at > gave.at)) gave = { key, at };
    }
    const startedMs = latest ? msOf(latest.startedAt) : NaN;
    const gaveUp = gave && !(Number.isFinite(startedMs) && startedMs >= gave.at) ? { key: gave.key, at: toIso(gave.at) } : null;

    const out = {
      queue,
      items: items.map((it) => ({
        key: it.key,
        jobId: it.jobId,
        state: it.state,
        since: toIso(it.since),
        behind: it.behind,
        runId: it.runId,
        stopAskedAt: it.stopAskedAt == null ? null : toIso(it.stopAskedAt),
        startRecorded: it.startRecorded,
        confirmation: it.confirmation,
      })),
      gaveUp,
    };
    return { out, live: live ? live.key : null };
  }

  /**
   * From the stop marks or the record under the key; a running pass falls back to a stop with its runId. A mark is the
   * stop of one execution, so a later execution of the same job in this process (a re-run after a stall) is not covered
   * by it (AC-3): a waiting item never is, a running one only through its own runId, a starting one only when it was
   * launched no later than the stop.
   */
  function stopAskedOf(it) {
    const mark = s.stopsAsked.get(it.key);
    const mine = !!mark && it.state === 'running'
      && (it.runId ? !mark.runId || mark.runId === it.runId : !(msOf(it.since) > mark.at));
    if (mine) return mark.at;
    const e = entryOf(it.key);
    if (e && isObject(e.stop)) return msOf(e.stop.at);
    if (it.state === 'running' && it.runId) {
      for (const v of s.stopsAsked.values()) if (v.runId === it.runId) return v.at;
      for (const x of Object.values(s.record.passes)) if (isObject(x) && isObject(x.stop) && x.stop.runId === it.runId) return msOf(x.stop.at);
    }
    return null;
  }

  /**
   * snapshot({ fresh }) or snapshot(d, { fresh }) → { queue, items, gaveUp }, every time an ISO string, or null for
   * one a Date cannot hold. Without fresh (the status route) one computed in the last second is reused while it carries
   * the current generation; one from an older generation, in flight or done, is neither served nor kept.
   */
  function snapshot(a, b) {
    const opts = isObject(b) ? b : (isObject(a) ? a : {});
    if (opts.fresh === true) return compute().then((r) => r.out);
    const gen = s.generation;
    const c = s.cache;
    if (c && c.gen === gen && (c.pending || Date.now() - c.at <= STATUS_REUSE_MS)) return c.promise;
    const entry = { gen, at: Date.now(), pending: true };
    entry.promise = compute().then((r) => r.out).finally(() => {
      entry.pending = false;
      if (s.cache === entry && s.generation !== gen) s.cache = null;
    });
    entry.promise.catch(() => { if (s.cache === entry) s.cache = null; });
    s.cache = entry;
    return entry.promise;
  }

  // ─── starts (D6, D8) ───────────────────────────────────────────────────────────────────────────────────────────

  async function add(key, timeoutMs) {
    const data = { taskName: TASK_NAME, customerArgs: null, queryParams: undefined, timeoutMs };
    try {
      await bounded(() => d.queue.add(TASK_NAME, data, { jobId: key, removeOnComplete: true, removeOnFail: true }), d.timers.stepMs);
      return { ok: true };
    } catch (err) {
      return { ok: false, timedOut: !!(err && err.timedOut), code: err && err.code };
    }
  }

  /** Run: refused while anything is busy; the record first, then the add. */
  async function runStep(who) {
    const { out } = await compute();
    if (out.queue !== 'ok') return queueUnavailable();
    if (out.items.length) return answer(409, { success: false, code: 'pass-busy', busy: out.items });
    const timeoutMs = d.taskTimeoutMs();
    const key = d.randomKey();
    s.linedUp.add(key);
    const at = iso(d.now());
    const wrote = await commitStart(key, at, who);
    if (!wrote.ok) return answer(500, { success: false, code: 'record-unavailable', cause: allowErrorCode(wrote.code) });
    const added = await add(key, timeoutMs);
    if (!added.ok) {
      s.skips.add(key); // an add that lands late completes without spawning (R1)
      await commit(takeBack(wrote.prior), [key]);
      bump();
      return added.timedOut ? queueUnavailable() : answer(500, { success: false, code: 'error', cause: allowErrorCode(added.code) });
    }
    bump();
    return answer(200, { success: true, linedUp: true, key, recorded: true });
  }

  /** The confirm route's start: joins a busy pass with no stop asked for; cannot be refused for want of a record. */
  async function confirmStep() {
    const { out } = await compute();
    if (out.queue !== 'ok') { bump(); return answer(200, { enqueued: false }); }
    if (out.items.some((it) => it.stopAskedAt == null)) { bump(); return answer(200, { enqueued: true, joined: true }); }
    const timeoutMs = d.taskTimeoutMs();
    const key = d.randomKey();
    s.linedUp.add(key);
    const wrote = await commitStart(key, iso(d.now()), { kind: 'confirmation' });
    const added = await add(key, timeoutMs);
    if (!added.ok) {
      s.skips.add(key);
      if (wrote.ok) await commit(takeBack(wrote.prior), [key]);
      bump();
      return answer(200, { enqueued: false });
    }
    bump();
    return answer(200, { enqueued: true, jobId: key });
  }

  function lineUp({ who, mode } = {}) {
    const confirm = mode === 'confirm';
    return step(() => (confirm ? confirmStep() : runStep(normalWho(who))))
      .catch((err) => answer(500, { success: false, code: 'error', cause: allowErrorCode(err && err.code), ...(confirm ? { enqueued: false } : {}) }));
  }

  // ─── Stop (D9) ─────────────────────────────────────────────────────────────────────────────────────────────────

  /** For a running target: the key that keeps its job from running again, or null (a legacy or unknown job id). */
  function rerunKeyOf(a) {
    if (!a.key.startsWith('run:')) return a.key;
    return a.jobId && a.jobId !== LEGACY_ID && JOB_ID_RE.test(a.jobId) ? a.jobId : null;
  }

  /** A starting target: wait for its first record, its run's end, or its job's end with no run. */
  async function waitForRun(a) {
    const until = Date.now() + d.timers.pidWaitMs;
    for (;;) {
      const latest = await latestRun();
      if (latest && isObject(latest.job) && String(latest.job.id) === a.jobId && (!a.phase || msOf(latest.startedAt) >= a.phase.since)) {
        return { runId: latest.runId, ended: latest.endedAt != null || !(await aliveOf(latest)) };
      }
      if (endedRecently(a.key)) return 'gone';
      if (Date.now() >= until) return 'unreachable';
      await sleep(d.timers.pidPollMs);
    }
  }

  /** SIGTERM to the target's own pass, re-read just before: its job and run, no earlier than its launch, alive. */
  async function signal(a) {
    const latest = await latestRun();
    if (!latest || latest.endedAt != null) return false;
    const sameRun = (!a.runId || latest.runId === a.runId)
      && (a.key.startsWith('run:') || (isObject(latest.job) && String(latest.job.id) === a.jobId));
    if (!sameRun || (a.phase && !(msOf(latest.startedAt) >= a.phase.since))) return false;
    if (!(await aliveOf(latest))) return false;
    const pid = isObject(latest.process) ? latest.process.pid : null;
    if (!Number.isInteger(pid) || pid <= 0) return false; // never a process group
    try {
      await d.kill(pid, 'SIGTERM');
      return true;
    } catch (_) {
      return false; // ESRCH: it ended first
    }
  }

  async function stopStep(who, targets) {
    const { out, live } = await compute();
    if (out.queue !== 'ok' && targets.some((t) => !isObject(t) || t.key !== live)) return queueUnavailable();
    // Every open item must be named, with the state the prompt showed; a target no longer open is left out.
    const asked = new Map(targets.filter(isObject).map((t) => [t.key, t.state]));
    const open = out.items.filter((it) => it.stopAskedAt == null);
    if (open.some((it) => asked.get(it.key) !== it.state)) return answer(409, { success: false, code: 'prompt-out-of-date', busy: out.items });
    let acts = open.map((it) => ({ key: it.key, state: it.state, runId: it.runId, jobId: it.jobId, phase: s.phases.get(it.key), tooLate: false }));
    if (!acts.length) return answer(409, { success: false, code: 'nothing-to-stop' });

    // Running targets first, so a refusal changes nothing.
    for (const a of acts) {
      if (a.state !== 'running' || a.runId) continue;
      const seen = await waitForRun(a);
      if (seen === 'unreachable') return answer(409, { success: false, code: 'pass-not-reachable' });
      if (seen === 'gone') a.gone = true;
      else { a.runId = seen.runId; a.tooLate = seen.ended; }
    }
    acts = acts.filter((a) => !a.gone);
    if (!acts.length) return answer(409, { success: false, code: 'nothing-to-stop' });

    // The effect in memory first, so a Stop works when it cannot be recorded.
    const atMs = d.now();
    const at = iso(atMs);
    for (const a of acts) {
      if (a.state === 'waiting') { s.skips.add(a.key); a.how = 'taken-out-of-line'; continue; }
      s.stopsAsked.set(a.key, { at: atMs, runId: a.runId || null });
      const rerunKey = rerunKeyOf(a);
      if (rerunKey) s.noRerun.add(rerunKey);
      a.how = a.tooLate ? 'too-late' : 'asked-to-stop';
    }
    // Then the record.
    const wrote = await commit((r) => {
      for (const a of acts) {
        const e = entryIn(r, a.key, a.jobId || null);
        e.stop = { at, runId: a.state === 'running' ? a.runId || null : null, who };
        if (a.state === 'waiting') {
          e.skip = true;
          const due = isScheduled(a.key) ? toIso(millisOf(a.key)) : null; // null: no millis, or none a Date can hold
          if (due !== null && !e.start) startOf(a.key, e.jobId, due, { kind: 'schedule' })(r);
        } else {
          const rerunKey = rerunKeyOf(a);
          if (rerunKey) entryIn(r, rerunKey, rerunKey).noRerun = true;
        }
        addLine(r, { action: 'stop', key: a.key, at, who });
      }
    }, acts.map((a) => a.key));
    // Then the signal, to each running pass that has not ended.
    for (const a of acts) {
      if (a.state === 'running' && !a.tooLate && !(await signal(a))) a.how = 'too-late';
    }
    bump();
    return answer(200, { success: true, stopped: acts.map((a) => ({ key: a.key, how: a.how })), recorded: wrote.ok });
  }

  function stop({ who, targets } = {}) {
    return step(() => stopStep(normalWho(who), Array.isArray(targets) ? targets : []))
      .catch((err) => answer(500, { success: false, code: 'error', cause: allowErrorCode(err && err.code) }));
  }

  s.ops = {
    step, keyOf, askedAt, isScheduled, isLineUpKey: (key) => LINEUP_ID.test(key), loadRecord, entryOf, recordStart, recordGaveUp, bump,
  };
  const gate = makeGate(s, d);
  return { lineUp, stop, snapshot, gate };
}

/** The process's one instance: the routes and the worker's gate share its chain, marks and record. */
const controller = createController();

module.exports = { createController, controller };
