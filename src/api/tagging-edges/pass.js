/**
 * Running and stopping the gap-filling pass (tagging-edges story 6, ADR tagging-edges/0006 D6, D7, D9, D13, D14).
 *
 *   POST /api/tagging-edges/pass/run      owner or admin: {} → lines up a pass; refused while one is waiting or running
 *   POST /api/tagging-edges/pass/stop     owner or admin: { targets: [{ key, state: 'waiting' | 'running' }] } → stops
 *                                         exactly the passes its prompt showed; refused when what is busy has changed
 *   GET  /api/tagging-edges/pass/record   owner or admin, this site only: who started and stopped each pass, and the
 *                                         last 10 actions
 *   handleRunTaskForPass                  POST /api/run-task?taskName=reconcileTaggingEdges, through runTask.js's branch
 *                                         (D7): answers as Run does, with a `message` for the Task Explorer; a direct
 *                                         local call is recorded as local
 *
 * Every start and stop is one step of the default controller's chain (src/pipeline/tagging-edges/control, D1), so the
 * routes and the task queue's worker decide in one order. Refusals are answered before the chain: who (ownerOrAdmin's
 * 401 and 403s, the cross-site one last), then the body (415, 400), then the task queue being off or Redis not ready
 * (503, Run only). Every handler resolves and never rejects: a throw answers 500 { code: 'error', cause } with an
 * allow-listed code. Fixed codes are sent as written; no answer carries a full pubkey, and no handler logs who (D11,
 * D14). Who reaches only the gated record read.
 *
 * Handlers take their dependencies as a third argument, for tests (§ Seams), as realtime.js does; the one defaultDeps
 * serves them all.
 */

const path = require('path');
const { allowErrorCode } = require('../../lib/tagging-edges/realtime');
const { sameHost, isJson, ownerOrAdmin } = require('./index');

const MAX_TARGETS = 50;
const TARGET_KEY_RE = /^[A-Za-z0-9:._@-]{1,120}$/;
const TARGET_STATES = ['waiting', 'running'];

/** The error sentence beside each fixed code (D14). */
const ERRORS = {
  'pass-busy': 'a pass is already waiting or running',
  'prompt-out-of-date': 'what is busy has changed since the prompt opened',
  'nothing-to-stop': 'nothing is waiting or running that the prompt named',
  'pass-not-reachable': 'the pass was starting and had not yet recorded its process',
  'record-unavailable': 'the action could not be recorded',
  QUEUE_UNAVAILABLE: 'the task queue is unavailable',
  error: 'the request could not be completed',
};

/** The Task Explorer's sentences for the run-task route's answers (D7). */
const MESSAGES = {
  'lined-up': 'A gap-filling pass was lined up.',
  'pass-busy': 'A pass is already waiting or running. Nothing new was lined up.',
  QUEUE_UNAVAILABLE: 'The task queue is unavailable. Nothing was lined up.',
  'record-unavailable': 'The start could not be recorded, so nothing was lined up.',
  error: 'The pass could not be lined up.',
  401: 'Sign in as the owner or an admin to run this pass.',
  403: 'Only the owner or an admin can run this pass.',
  'cross-site': 'A request from another site was refused. Nothing was lined up.',
};

const control = () => require('../../pipeline/tagging-edges/control');
const controlStore = () => require('../../pipeline/tagging-edges/control/store');

/** The real dependencies, required lazily so this module loads stack-free. */
function defaultDeps() {
  return {
    stateDir: () => require('../../pipeline/tagging-edges/state').stateDir(),
    ownerPubkey: () => require('../../utils/config').getConfigFromFile('BRAINSTORM_OWNER_PUBKEY'),
    getAdminPubkeys: () => require('../../utils/config').getAdminPubkeys(),
    taskQueueEnabled: () => require('../../utils/brainstormConfig').get('TASK_QUEUE_ENABLED') === 'true',
    queueHealth: () => require('../../manage/taskQueue/queue').queueHealth(),
    lineUp: (args) => control().controller.lineUp(args),
    stop: (args) => control().controller.stop(args),
  };
}

/** As realtime.js's withDeps. The default record read is the controller's store, under the handler's own stateDir(). */
function withDeps(deps) {
  const given = deps && typeof deps === 'object' ? deps : {};
  const d = { ...defaultDeps(), ...given };
  if (typeof given.getOwnerPubkey === 'function') d.ownerPubkey = given.getOwnerPubkey;
  else if (typeof given.ownerPubkey === 'string') { const o = given.ownerPubkey; d.ownerPubkey = () => o; }
  if (typeof given.readRecord !== 'function') d.readRecord = () => controlStore().createStore({ dir: path.join(d.stateDir(), 'control') }).read();
  return d;
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Who as the controller records it: the role and an 8-character key, never the full pubkey (D11, D14). */
const whoOf = (v) => ({ kind: v.role, key: v.pubkey.slice(0, 8) });
const failed = (err) => ({ status: 500, body: { success: false, code: 'error', cause: allowErrorCode(err && err.code) } });
/** A controller answer with its error sentence beside the code. */
const withError = (body) => (body && body.success === false && body.code && !body.error ? { ...body, error: ERRORS[body.code] || ERRORS.error } : body);

/** Pure. Stop's body (D9) → { ok: true, targets: [{ key, state }] } | { ok: false, status: 400, error }. */
function validateStop(body) {
  const bad = { ok: false, status: 400, error: `the body must be {"targets": [{"key": …, "state": "waiting" | "running"}]}, 1 to ${MAX_TARGETS} distinct keys of at most 120 characters of A-Z a-z 0-9 : . _ @ -` };
  const targets = isObject(body) ? body.targets : undefined;
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > MAX_TARGETS) return bad;
  const keys = new Set();
  for (const t of targets) {
    if (!isObject(t) || typeof t.key !== 'string' || !TARGET_KEY_RE.test(t.key) || !TARGET_STATES.includes(t.state) || keys.has(t.key)) return bad;
    keys.add(t.key);
  }
  return { ok: true, targets: targets.map((t) => ({ key: t.key, state: t.state })) };
}

/**
 * Run's checks after who and the body, and its chain step (D6), shared with the run-task delegate (D7): the task
 * queue off, or Redis not ready, is refused before the chain; then the controller's lineUp. → { status, body }
 */
async function runStep(d, who) {
  try {
    if (!(await d.taskQueueEnabled()) || (await d.queueHealth()) !== 'ready') {
      return { status: 503, body: { success: false, code: 'QUEUE_UNAVAILABLE' } };
    }
    const out = await d.lineUp({ who, mode: 'run' });
    if (!out || !Number.isInteger(out.status) || !isObject(out.body)) return failed(null);
    return out;
  } catch (err) {
    return failed(err);
  }
}

/** POST /api/tagging-edges/pass/run {} — owner or admin. */
async function handlePassRun(req, res, deps) {
  const d = withDeps(deps);
  const who = ownerOrAdmin(req, d);
  if (!who.ok) return res.status(who.status).json({ success: false, error: who.error });
  if (!isJson(req)) return res.status(415).json({ success: false, error: 'the body must be application/json' });
  if (!isObject(req.body) || Object.keys(req.body).length !== 0) return res.status(400).json({ success: false, error: 'the body must be {}' });
  const out = await runStep(d, whoOf(who));
  return res.status(out.status).json(withError(out.body));
}

/**
 * The run-task route's branch for this pass (D7): a direct local call is { kind: 'local' }, anyone else is re-checked
 * by ownerOrAdmin; the cross-site rule holds for both. No JSON is required (the Task Explorer posts no body). Every
 * answer carries a message for the Task Explorer's modal.
 */
async function handleRunTaskForPass(req, res, deps) {
  const d = withDeps(deps);
  let who;
  if (req && req.localTrusted === true) {
    if (!sameHost(req)) return res.status(403).json({ success: false, error: 'cross-site request refused', message: MESSAGES['cross-site'] });
    who = { kind: 'local' };
  } else {
    const v = ownerOrAdmin(req, d);
    if (!v.ok) {
      const message = v.error === 'cross-site request refused' ? MESSAGES['cross-site'] : MESSAGES[v.status];
      return res.status(v.status).json({ success: false, error: v.error, message });
    }
    who = whoOf(v);
  }
  const out = await runStep(d, who);
  const b = out.body;
  if (out.status === 200 && b.success === true) {
    return res.json({ success: true, message: MESSAGES['lined-up'], queued: true, jobId: b.key });
  }
  const code = b.code || 'error';
  const answer = { success: false, code, error: ERRORS[code] || ERRORS.error, message: MESSAGES[code] || MESSAGES.error };
  if (b.cause !== undefined) answer.cause = b.cause;
  return res.status(out.status).json(answer);
}

/** POST /api/tagging-edges/pass/stop { targets } — owner or admin. */
async function handlePassStop(req, res, deps) {
  const d = withDeps(deps);
  const who = ownerOrAdmin(req, d);
  if (!who.ok) return res.status(who.status).json({ success: false, error: who.error });
  if (!isJson(req)) return res.status(415).json({ success: false, error: 'the body must be application/json' });
  const v = validateStop(req.body);
  if (!v.ok) return res.status(v.status).json({ success: false, error: v.error });
  let out;
  try {
    out = await d.stop({ who: whoOf(who), targets: v.targets });
    if (!out || !Number.isInteger(out.status) || !isObject(out.body)) out = failed(null);
  } catch (err) {
    out = failed(err);
  }
  return res.status(out.status).json(withError(out.body));
}

/**
 * Pure. The record as the store reads it (null, { unreadable, readError }, { damaged }, or the parsed record) → the
 * record read's answer (D13): { state: 'recorded' | 'empty' | 'unreadable' | 'damaged', readError?, history, passes }.
 */
function recordView(r) {
  if (r === null || r === undefined) return { state: 'empty', history: [], passes: {} };
  if (isObject(r) && r.unreadable === true) return { state: 'unreadable', readError: allowErrorCode(r.readError), history: [], passes: {} };
  if (!isObject(r) || r.damaged === true || r.version !== 1 || !isObject(r.passes) || !Array.isArray(r.history)) {
    return { state: 'damaged', history: [], passes: {} };
  }
  return { state: 'recorded', history: r.history, passes: r.passes };
}

/** GET /api/tagging-edges/pass/record — owner or admin, this site only. It writes nothing. */
async function handlePassRecord(req, res, deps) {
  const d = withDeps(deps);
  const who = ownerOrAdmin(req, d);
  if (!who.ok) return res.status(who.status).json({ success: false, error: who.error });
  let r;
  try {
    r = await d.readRecord();
  } catch (err) {
    // A read that throws reads as the store maps a read error (D11).
    r = { unreadable: true, readError: (err && err.code) || 'error' };
  }
  return res.json({ success: true, ...recordView(r) });
}

module.exports = {
  defaultDeps,
  validateStop,
  recordView,
  handlePassRun,
  handlePassStop,
  handlePassRecord,
  handleRunTaskForPass,
};
