'use strict';
/**
 * Tests for Story 6 (epic tagging-edges) — the pass's routes: Run, Stop, the gated record read, and the general run-task
 * route's branch for this pass.
 *
 * Story: engineering-team/stories/tagging-edges/6-pass-run-and-stop.md — AC-1 (Run: lined up, refused while busy, just
 *        after a pass ends, the queue unavailable), AC-3 (Stop: what it acts on, the stale prompt, nothing to stop),
 *        AC-4 (who may: every refused caller changes and records nothing; either may act on the other's pass; the
 *        run-task route answers as Run does, local calls exempt from the who-check only, other tasks unchanged), AC-5
 *        (who did it: each kind of who, a Run refused when it cannot be recorded, a Stop that takes effect unrecorded,
 *        who readable only by the owner or an admin), and the Test tasks "Server cases for AC-1 and AC-4" and "Server
 *        cases for AC-5" as corrected at Architecture (2026-10-27).
 * ADR:   engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md — Implementation notes ("The routes": one
 *        defaultDeps, with getAdminPubkeys), D6 (Run: the handler's checks, the off-queue refusal, the chain step, the
 *        answers, "every exported pass.js handler resolves and never rejects"), D7 (the run-task branch and its
 *        delegate: who, sameHost for local calls, no JSON, the answers with `message`, the flag off), D9 (Stop: the
 *        body, the answers), D11 (the record's shape and reading rules), D13 (GET /api/tagging-edges/pass/record),
 *        D14 (answers and codes) and § Seams for Test Design (the deps list; "The run-task route through the
 *        middleware").
 *
 * Intentionally failing until the implementation lands (red phase): src/api/tagging-edges/pass.js and
 * src/pipeline/tagging-edges/control/ do not exist yet, and today's handleRunTask has no branch for this pass. Every
 * module is loaded lazily inside each test through test/helpers/taggingEdgesPassFakes.js's loadModule, which names
 * what is missing and the ADR decision, so this suite always loads and each test fails on what it pins.
 *
 * Classes (all PX):
 *   PX1        pass.js's exports.
 *   PX2–PX12   POST /api/tagging-edges/pass/run through handlePassRun (D6); PX6b: the queue checks are answered
 *              before the chain, while another Run holds it (D6, D1).
 *   PX13–PX19  handleRunTaskForPass, the run-task branch's delegate, with injected deps (D7).
 *   PX20–PX26  POST /api/tagging-edges/pass/stop through handlePassStop (D9).
 *   PX27–PX29  GET /api/tagging-edges/pass/record through handlePassRecord (D13, D11).
 *   PX30       D14 across every answer: fixed codes as written, thrown codes as an allow-listed cause, no full pubkey.
 *   PX31–PX32  defaultDeps includes getAdminPubkeys (the SWR74 trap): a static presence check (ADR 0006 names no form
 *              for the provider), and an admin admitted with only the defaults in a child process.
 *   PX33–PX37  POST /api/run-task through the REAL auth middleware in front of the REAL handleRunTask, in a child
 *              process (§ Seams, "The run-task route through the middleware").
 *   PX38       after the owner's, an admin's and a local call's Runs and Stops, a signed-out reader's public views (the
 *              status, the held list, the Task Explorer's data for this task) and everything logged carry no who, in
 *              the same child process (AC-5 "Who may read it"; § Constraints; D11 "Who is never logged").
 *   PX39       added after Implementation (2026-10-28; ADR 0006 Amendment 1 § A): a busy job added another way under an
 *              id D9's old rule refused but BullMQ accepts ("manual run", "job/1", 130 characters) is listed busy, a
 *              Stop naming it with the other open items takes each out of line, and the gate skips each.
 *
 * Hermetic: the controller's and routes' deps are the helper's makeWorld (the § Seams list: a BullMQ-faithful fake
 * queue, an in-memory record, a fake process table, a fixed clock), so no Redis, no /proc of the host, no disk record.
 * run() points TAGGING_EDGES_STATE_DIR at a temporary directory and sets BRAINSTORM_STRUCTURED_LOGGING=false for the
 * whole run (both restored after); after every test each world's stateDir() is checked for a record.json written
 * around the injected record deps. run() also replaces process.kill for the whole run (the helper's guardProcessKill,
 * as the CT suite does): every call is refused with ESRCH, so a fake pid can never signal a real process, and a test
 * whose code under test reached it fails. The real-middleware cases run in a child process with a temp
 * brainstorm.conf (BRAINSTORM_CONF_PATH) naming the owner and a temp settings file (TAPESTRY_SETTINGS_PATH) naming the
 * admin, every child_process entry point replaced by a recorder that launches nothing, and the task queue module
 * replaced in require's cache by a recording stub, so the old run-task path can neither reach Redis nor spawn a task in
 * the red phase. Before any module loads, the child also installs the helper's recordStructuredEvents (a stand-in for
 * src/utils/structuredEvents.js that records and writes nothing; real structured logging stays off),
 * captureConsole (in place of silencing the console) and guardProcessKill, and points BRAINSTORM_LOG_DIR at a temp
 * directory, the only place the Task Explorer read of PX38 finds an events.jsonl. Fake 64-hex pubkeys only (the
 * helper's OWNER, ADMIN, STRANGER).
 *
 * Choices this suite makes where the ADR leaves a detail open (recorded in the Test Design return):
 *   - How a handler reaches its controller. The ADR says the routes and the worker share one instance (D1) and that
 *     tests build their own with createController(deps), and names index.js's deps d.lineUp and d.snapshot (D8). PX
 *     passes every handler the world's § Seams deps PLUS one controller instance built from them, under `controller`
 *     and as `lineUp`, `stop` and `snapshot` (D8's names). A handler that reads its controller through any of those
 *     works. Cases that drive the gate (PX8 "behind heavy work", PX18) need the handler to use that instance.
 *   - How the real-middleware cases inject the delegate's deps. D7's branch calls
 *     `require('../../tagging-edges/pass').handleRunTaskForPass(req, res)`, which reads the export at call time. The
 *     child replaces that export with a wrapper that counts the call and calls the original with (req, res, deps of the
 *     request's world). A branch that captured the function at load would not see the wrapper, and PX33–PX36 then say
 *     the delegate was never reached.
 *   - Refusal sentences. D6/D7/D13 re-check with index.js's ownerOrAdmin, so its three sentences are expected exactly
 *     ('Not authenticated', 'Owner or admin access required', 'cross-site request refused'); the middleware's two
 *     bodies are expected exactly where it answers. 415 and 400 pin the status and success: false only.
 *   - A local call refused by sameHost carries the same sentence, "cross-site request refused", as every sameHost
 *     refusal in tagging-edges/index.js (:187, :272). D7 gives a local call { kind: 'local' } without ownerOrAdmin and
 *     fixes only "403 … each with a message" for it, so this sentence is the suite's choice (PX15's two local rows,
 *     PX34's local-other-site).
 *   - The randomKey seam. § Seams lists randomKey without saying what it returns, and D2 writes the id as
 *     'reconcileTaggingEdges-' + randomBytes(6).toString('hex'). Here randomKey() returns the whole job id
 *     (LINEUP_ID-shaped), not its hex: an implementation that adds the prefix to it again fails every LINEUP_ID check
 *     (PX2, PX13).
 *   - The queue checks answered before the chain (PX6b): while another Run's hung add holds the chain (stepMs 5000
 *     for that world, so the hold outlasts the check), a queue-off Run must answer within 800 ms of real time.
 *   - The 409's busy items (PX8) may carry D5's item members and D12's two additions, and nothing else: key, jobId,
 *     state, since, behind, runId, stopAskedAt, startRecorded, confirmation. A member under any other name could carry
 *     who.
 *   - Who, for PX38: a full pubkey of the owner or an admin (either case), their shortened keys, a member named "who",
 *     or one of the four private kinds (owner, admin, local, confirmation) as JSON ('"kind":"local"') or as console
 *     prints it ("kind: 'local'"). The schedule's kind is not looked for: § Constraints keeps a scheduled run's job id
 *     public. The search covers each signed-out answer, every structured event and console line from PX38's actions
 *     and reads, and every launch recorded meanwhile; the owner's gated record read in the same world must name each
 *     who, so the search is shown to find them. A kind as a bare word ('local') is no needle (the task registry's own
 *     text says "owner confirmation"), so each status read's control, and its busy items, must hold only D12's members.
 *   - A direct local call (no session) on the panel's Run, Stop and record routes is refused 401: only the run-task
 *     branch turns req.localTrusted into who (D7); D6, D9 and D13 re-check ownerOrAdmin, which admits no loopback.
 *   - Body validation. D6: "The body is {}" — {} (and only {}) is accepted. D9's key rule is Amendment 1 § A's
 *     (2026-10-28), which superseded "at most 120 characters of [A-Za-z0-9:._@-]": a key is a string of 1 to 256
 *     UTF-16 code units (key.length) with no character of U+0000–U+001F, U+007F–U+009F, U+2028 or U+2029. Every rule
 *     is pinned on both sides of its boundary, the empty key included (PX21). The 400's sentence is the Implementer's
 *     wording; PX21 asks only that it names the 256 bound and no longer the 120 one. The suite builds every control
 *     or non-ASCII key character from its code point (String.fromCharCode), so no raw U+2028 or U+2029 sits in this
 *     file.
 *   - D6 step 3's "503 QUEUE_UNAVAILABLE, or 500 {code: 'error', cause}": an add that times out must be 503; one that
 *     rejects may be either. The record GET with a throwing readRecord may answer 500 {code: 'error'} or 200
 *     {state: 'unreadable'}; a Stop with every dep throwing may answer 500 or 503. Each is a resolved answer either way.
 *   - The record GET's answer is pinned exactly ({success, state, readError?, history, passes}); for 'empty',
 *     'unreadable' and 'damaged', history is [] and passes is {}.
 *   - D7's repeated `taskName=…&taskName=…`: qs makes it an array of two, so String() gives 'x,x' and the registry
 *     lookup misses too. PX36 pins that no query form starts this pass outside the delegate, not that the repeated
 *     form reaches it.
 *
 * Hand-rolled in the project's existing test style — no new framework. Works on Node 16 and 22.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./helpers/taggingEdgesPassFakes');

const { REPO, OWNER, ADMIN, STRANGER, OWNER_KEY, ADMIN_KEY, TASK, LINEUP_ID, PATHS, MODULES, adr } = H;
const T0 = H.T0;
const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const OTHER_TASK = 'reconcileRecent';
const ODD_CODE = 'neo4j.internal:7687';
/** ownerOrAdmin's sentences (src/api/tagging-edges/index.js), which D6, D7 and D13 re-check with. */
const E401 = 'Not authenticated';
const E403 = 'Owner or admin access required';
const EXSITE = 'cross-site request refused';
/** The auth middleware's bodies (src/middleware/auth.js refuse(); ADR 0006 § Context). */
const MW_401 = { success: false, error: 'Sign in as the owner or an admin to do this.' };
const MW_403 = { success: false, error: 'Only the owner or an admin can do this.' };
/** D7's fixed messages. */
const LINED_UP_MESSAGE = 'A gap-filling pass was lined up.';
const BUSY_MESSAGE = 'A pass is already waiting or running. Nothing new was lined up.';
/** D14's fixed codes. */
const FIXED_CODES = ['pass-busy', 'prompt-out-of-date', 'nothing-to-stop', 'pass-not-reachable', 'record-unavailable', 'QUEUE_UNAVAILABLE'];
/** D9's key characters. */
const KEY_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:._@-';
const PASS_EXPORTS = { handlePassRun: 'function', handlePassStop: 'function', handlePassRecord: 'function', handleRunTaskForPass: 'function' };
/** D5's item members and D12's two additions: all a busy item may carry (the header's Choices). */
const BUSY_ITEM_MEMBERS = ['key', 'jobId', 'state', 'since', 'behind', 'runId', 'stopAskedAt', 'startRecorded', 'confirmation'];
/**
 * Who, as a signed-out reader or a log must never see it (AC-5 "Who may read it"; ADR 0006 § Constraints: the owner,
 * an admin, a local call and the owner's confirmation stay indistinguishable; D11 "Who is never logged"). JSON forms,
 * and the forms console prints an object in.
 */
const WHO_NEEDLES = [
  ['the owner\'s pubkey', OWNER], ['the owner\'s pubkey in upper case', OWNER.toUpperCase()],
  ['an admin\'s pubkey', ADMIN], ['an admin\'s pubkey in upper case', ADMIN.toUpperCase()],
  ['the owner\'s shortened key', OWNER_KEY], ['an admin\'s shortened key', ADMIN_KEY],
  ['a member named "who"', '"who"'],
  ['the kind "owner"', '"kind":"owner"'], ['the kind "admin"', '"kind":"admin"'], ['the kind "local"', '"kind":"local"'], ['the kind "confirmation"', '"kind":"confirm'],
  ['the kind "owner", printed', 'kind: \'owner\''], ['the kind "admin", printed', 'kind: \'admin\''], ['the kind "local", printed', 'kind: \'local\''], ['the kind "confirmation", printed', 'kind: \'confirm'],
];
/** The labels of every WHO_NEEDLES needle found in `text`. */
function whoFound(text) {
  const s = String(text == null ? '' : text);
  return WHO_NEEDLES.filter(([, n]) => s.includes(n)).map(([label]) => label);
}

// ─── test harness ──────────────────────────────────────────────────────────────────────────────────────────────
const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function assert(cond, msg) { if (!cond) throw new Error(msg || 'Assertion failed'); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object' && !Buffer.isBuffer(v)) return Object.keys(v).sort().reduce((o, k) => { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}
function show(v) {
  if (v === undefined) return 'undefined';
  if (v instanceof Error) return `<${v.code || 'Error'}: ${H.firstLine(v)}>`;
  try {
    return JSON.stringify(sortKeys(v), (k, x) => (typeof x === 'string' && x.length > 160 ? `${x.slice(0, 60)}…(${x.length} characters)` : x));
  } catch (_) {
    return String(v);
  }
}
function exact(v) { return JSON.stringify(sortKeys(v)); }
const firstLine = H.firstLine;
const iso = H.iso;
const has = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const showRes = (r) => `${r.status} ${show(r.body)}`;
/** Throw every problem at once. */
function report(problems) { assert(problems.length === 0, problems.join('\n        ')); }
/** Run several cases; report every failing one, not only the first. */
async function cases(list, fn) {
  const failed = [];
  for (const c of list) {
    try { await fn(c); } catch (e) { failed.push(`[${c.name}] ${e.message}`); }
  }
  assert(failed.length === 0, `${failed.length} of ${list.length} case(s) failed:\n        ${failed.join('\n        ')}`);
}

// ─── lazy loading ──────────────────────────────────────────────────────────────────────────────────────────────
function passMod() { return H.loadModule(MODULES.pass, PASS_EXPORTS, adr('D6, D7, D9, D13; Implementation notes, "The routes"')); }
function controllerMod() {
  return H.loadModule(MODULES.controller, { createController: 'function' }, adr('D1 — the routes are tested with a controller instance built from injected deps'));
}
function allowErrorCode(code) {
  return H.loadModule('src/lib/tagging-edges/realtime.js', { allowErrorCode: 'function' }, 'ADR tagging-edges/0005 (allowErrorCode)').allowErrorCode(code);
}

// ─── worlds, a controller per world, and the handlers' deps ────────────────────────────────────────────────────
const WORLDS = [];
/** The world's § Seams deps, plus one controller instance built from them (see the header: "How a handler reaches its controller"). */
function withController(deps, ctl) {
  return Object.assign({}, deps, {
    controller: ctl,
    lineUp: (...a) => ctl.lineUp(...a),
    stop: (...a) => ctl.stop(...a),
    snapshot: (...a) => ctl.snapshot(...a),
  });
}
/**
 * A world (H.makeWorld), its controller, the handlers' deps, and callers for each route. Loads pass.js first, so a red
 * run names it.
 */
function scene(o = {}) {
  const pass = passMod();
  const { createController } = controllerMod();
  const world = H.makeWorld(o);
  WORLDS.push(world);
  let ctl;
  try { ctl = createController(world.deps); } catch (e) { throw new Error(`createController(deps) threw: ${firstLine(e)} (${adr('D1')})`); }
  assert(ctl && typeof ctl.lineUp === 'function' && typeof ctl.stop === 'function' && typeof ctl.snapshot === 'function' && ctl.gate && typeof ctl.gate === 'object',
    `createController(deps) should return { lineUp, stop, snapshot, gate } (${adr('D1')}); it returned ${show(ctl && Object.keys(ctl))}`);
  const deps = withController(world.deps, ctl);
  const s = {
    pass, world, ctl, deps,
    /** POST Run as `as`, same site, JSON {} unless `o` says otherwise. */
    run: (as = 'owner', ro = {}) => call(pass.handlePassRun, H.passReq(as, { path: PATHS.run, origin: 'same', ...ro }), ro.deps || deps, `Run as ${as}`),
    /** POST Stop as `as` with { targets }. */
    stop: (as, targets, ro = {}) => call(pass.handlePassStop, H.passReq(as, { path: PATHS.stop, origin: 'same', body: { targets }, ...ro }), ro.deps || deps, `Stop as ${as}`),
    /** GET the record as `as`. */
    record: (as = 'owner', ro = {}) => call(pass.handlePassRecord, H.passReq(as, { method: 'GET', path: PATHS.record, origin: 'same', ...ro }), ro.deps || deps, `GET the record as ${as}`),
    /** The run-task delegate as the Task Explorer calls it: POST, no body, no content type; a local call sends no Origin. */
    runTask: (as = 'owner', ro = {}) => call(pass.handleRunTaskForPass, H.passReq(as, {
      path: PATHS.runTask, query: { taskName: TASK }, contentType: null, body: undefined, origin: as === 'local' ? undefined : 'same', ...ro,
    }), ro.deps || deps, `run-task as ${as}`),
    mark: () => mark(world),
    since: (m) => since(world, m),
    record_: () => world.record.parsed(),
  };
  return s;
}
function cleanupWorlds() {
  const problems = [];
  for (const w of WORLDS.splice(0)) {
    try { w.queue.releaseHangs(); } catch (_) { /* nothing hung */ }
    try {
      const dir = w.stateDirPath();
      const found = [];
      const walk = (d) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p); else found.push(path.relative(dir, p)); } };
      walk(dir);
      if (found.length) problems.push(`a handler wrote ${show(found)} under its stateDir() instead of through the injected readRecord/writeRecord/renameRecord (${adr('§ Seams')}: the deps list)`);
    } catch (_) { /* best effort */ }
    w.cleanup();
  }
  return problems;
}

/** What an answer must never carry: a full pubkey (either case), or the odd code's text. */
function leakProblems(label, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body === undefined ? null : body);
  const p = [];
  for (const pk of [OWNER, ADMIN, STRANGER]) {
    if (text.includes(pk) || text.includes(pk.toUpperCase())) p.push(`${label}: the answer carries a full pubkey (${pk.slice(0, 8)}…) — ${adr('D14')}: "No answer carries a full pubkey"`);
  }
  if (text.includes(ODD_CODE)) p.push(`${label}: the answer carries the thrown error's text ${show(ODD_CODE)} — ${adr('D14')}: a thrown code goes only through allowErrorCode`);
  return p;
}
/** Call a handler; it must answer, never reject (D6), and carry no full pubkey (D14). */
async function call(fn, req, deps, label) {
  const r = await H.callHandler(fn, req, deps, { timeoutMs: 4000 });
  if (r.rejected) throw new Error(`${label}: the handler rejected (${firstLine(r.rejected)}) — ${adr('D6')}: "Every exported pass.js handler resolves and never rejects"`);
  report(leakProblems(label, r.body));
  return r;
}

function mark(w) {
  return { calls: w.calls.length, q: w.queue.calls.length, writes: w.record.writes.length, renames: w.record.renames.length, kills: w.kills.length, keys: w.keys.length };
}
function since(w, m) {
  return {
    names: w.calls.slice(m.calls).map((c) => c.name),
    queue: w.queue.calls.slice(m.q).map((c) => c.method),
    adds: w.queue.calls.slice(m.q).filter((c) => c.method === 'add').map((c) => c.args[2] && c.args[2].jobId),
    writes: w.record.writes.length - m.writes,
    renames: w.record.renames.length - m.renames,
    kills: w.kills.slice(m.kills),
    keys: w.keys.slice(m.keys),
  };
}
/** A refused request touches nothing: no dependency call, no queue call, no record write, no signal. */
function untouchedProblems(label, d) {
  const p = [];
  if (d.names.length) p.push(`${label}: called ${show([...new Set(d.names)])} before refusing — a refusal is answered before the chain and reads, writes, lines up and signals nothing (${adr('D1')} "Refusals happen outside the chain"; AC-4 "changes and records nothing")`);
  if (d.queue.length) p.push(`${label}: called the queue (${show(d.queue)})`);
  if (d.writes || d.renames) p.push(`${label}: wrote the record (${d.writes} write(s), ${d.renames} rename(s))`);
  if (d.kills.length) p.push(`${label}: sent a signal ${show(d.kills)}`);
  return p;
}
function statusProblems(label, r, status, extra = '') {
  return r.status === status ? [] : [`${label}: should answer ${status}${extra}; answered ${showRes(r)}`];
}
/** The members `want` names, with their values (other members allowed). */
function membersProblems(label, body, want) {
  const p = [];
  for (const [k, v] of Object.entries(want)) {
    if (!has(body, k) || exact(body[k]) !== exact(v)) p.push(`${label}: ${k} should be ${show(v)}; the answer is ${show(body)}`);
  }
  return p;
}
const refusedBody = (body, error) => !!body && body.success === false && body.error === error;
const historyOf = (rec) => (rec && Array.isArray(rec.history) ? rec.history : []);
const entryOf = (rec, key) => (rec && rec.passes && rec.passes[key]) || null;

/** The common refused callers on the panel's routes, with ownerOrAdmin's answer (D6, D9, D13). */
const PANEL_REFUSALS = [
  { name: 'a signed-out request', as: 'signed-out', status: 401, error: E401 },
  { name: 'a session that is not authenticated (the owner\'s key, authenticated false)', as: 'unauthenticated', status: 403, error: E403 },
  { name: 'a signed-in user who is neither owner nor admin', as: 'stranger', status: 403, error: E403 },
  { name: 'the owner, from another site', as: 'owner', origin: 'other', status: 403, error: EXSITE },
  { name: 'an admin, with an Origin that does not parse (null)', as: 'admin', origin: 'null', status: 403, error: EXSITE },
  { name: 'a direct local call (no session; only run-task admits local calls, D7)', as: 'local', origin: undefined, status: 401, error: E401 },
];

/** A world with every spied dependency throwing (or rejecting) with the odd code. */
function burningDeps(world) {
  const boom = () => Object.assign(new Error(`connect ECONNREFUSED bolt://${ODD_CODE}`), { code: ODD_CODE });
  const d = { ...world.deps };
  for (const n of ['randomKey', 'readReport', 'readConfirmation', 'isAlive', 'listClaimed', 'queueHealth', 'taskQueueEnabled', 'kill', 'readRecord', 'writeRecord', 'renameRecord']) {
    d[n] = () => { throw boom(); };
  }
  d.queue = { getDelayed: async () => { throw boom(); }, getJobs: async () => { throw boom(); }, getActive: async () => { throw boom(); }, add: async () => { throw boom(); } };
  return d;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX1 — the exports
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX1: src/api/tagging-edges/pass.js loads and exports handlePassRun, handlePassStop, handlePassRecord and handleRunTaskForPass as functions, and its one defaultDeps (a function returning the deps, or the deps object) [ADR tagging-edges/0006 Implementation notes ("The routes" means the new src/api/tagging-edges/pass.js. Its one defaultDeps serves every handler in it), D6, D7, D9, D13]', () => {
  const pass = passMod();
  const t = typeof pass.defaultDeps;
  assert(t === 'function' || (t === 'object' && pass.defaultDeps !== null), `${MODULES.pass} should export defaultDeps (${adr('Implementation notes')}); it is ${t}. It exports ${show(Object.keys(pass))}`);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX2–PX12 — Run (D6)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX2: with nothing busy, the owner and an admin each line up a pass — 200 { success: true, linedUp: true, key, recorded: true } with a LINEUP_ID-shaped key; exactly one job is added under that key and waits; the record holds its start with who { kind: "owner" | "admin", key: <8 hex> } at the time it was asked for, and the history\'s newest line is { action: "start", key, at, who } [AC-1 "When nothing is busy, the server lines up a pass"; AC-5 "the owner or an admin, with a shortened key"; ADR tagging-edges/0006 D2, D6 steps 2-4, D11]', async () => {
  await cases([
    { name: 'the owner', as: 'owner', who: H.whoOf('owner') },
    { name: 'an admin', as: 'admin', who: H.whoOf('admin') },
  ], async (c) => {
    const s = scene();
    const m = s.mark();
    const r = await s.run(c.as);
    const d = s.since(m);
    const p = statusProblems('Run', r, 200);
    const key = r.body && r.body.key;
    p.push(...membersProblems('Run', r.body, { success: true, linedUp: true, recorded: true }));
    if (typeof key !== 'string' || !LINEUP_ID.test(key)) p.push(`the answer's key should match ${LINEUP_ID} (${adr('D2')}); it is ${show(key)}`);
    if (d.adds.length !== 1 || d.adds[0] !== key) p.push(`exactly one job should be added, under the answer's key ${show(key)} (${adr('D2')}: "Each start adds a job under a new, opaque id"); adds: ${show(d.adds)}`);
    if (typeof key === 'string' && s.world.queue.state(key) !== 'waiting') p.push(`the new job should be waiting; it is ${show(s.world.queue.state(key))}`);
    const rec = s.record_();
    const e = entryOf(rec, key);
    if (!e || !e.start) p.push(`the record should hold the start under ${show(key)} (${adr('D6')} step 2, D11); the record is ${show(rec)}`);
    else {
      if (exact(e.start.who) !== exact(c.who)) p.push(`the start's who should be ${show(c.who)}; it is ${show(e.start.who)}`);
      if (e.start.at !== iso(T0)) p.push(`the start's at should be the time it was asked for, ${iso(T0)} (AC "Action … Its time is when it was asked for"); it is ${show(e.start.at)}`);
      if (e.jobId !== key) p.push(`the entry's jobId should be ${show(key)} (${adr('D11')}); it is ${show(e.jobId)}`);
    }
    const h0 = historyOf(rec)[0];
    if (exact(h0) !== exact({ action: 'start', key, at: iso(T0), who: c.who })) p.push(`the history's newest line should be ${show({ action: 'start', key, at: iso(T0), who: c.who })}; the history is ${show(historyOf(rec))}`);
    report(p);
  });
});

test('PX3: every refused caller of Run gets ownerOrAdmin\'s answer and touches nothing — signed out 401 "Not authenticated"; a session that is not authenticated, and a signed-in stranger, 403 "Owner or admin access required"; the owner from another site, and an admin with Origin null, 403 "cross-site request refused"; a direct local call 401 — no dependency is called, no job is added, no record is written; the owner\'s same-site Run in the same world then does line up a pass [AC-4 "It refuses everyone else, and changes and records nothing"; ADR tagging-edges/0006 D6 "It re-checks ownerOrAdmin(req, d) (401, role 403, cross-site 403)", D1 "Refusals happen outside the chain"]', async () => {
  const s = scene();
  const p = [];
  for (const c of PANEL_REFUSALS) {
    const m = s.mark();
    const r = await s.run(c.as, { origin: c.origin });
    p.push(...statusProblems(c.name, r, c.status, ` ${show({ success: false, error: c.error })}`));
    if (r.status === c.status && !refusedBody(r.body, c.error)) p.push(`${c.name}: the body should carry success false and error ${show(c.error)}; it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  const m = s.mark();
  const ok = await s.run('owner');
  const d = s.since(m);
  if (ok.status !== 200 || d.adds.length !== 1 || d.names.length === 0) p.push(`the paired owner's Run should answer 200, call the deps and add one job (so the refusals above were checked on a live path); it answered ${showRes(ok)}, called ${show(d.names)}, added ${show(d.adds)}`);
  report(p);
});

test('PX4: Run\'s checks run in D6\'s order — who first (a stranger posting text/plain is 403, not 415), then the site (the owner from another site posting text/plain and an array is 403 cross-site), then JSON (the owner posting text/plain with { a: 1 } is 415, not 400), then the body (the owner posting JSON { a: 1 } is 400); each touches nothing, and "application/json; charset=utf-8" with {} is accepted [ADR tagging-edges/0006 D6 "It re-checks ownerOrAdmin(req, d) (401, role 403, cross-site 403), then requires JSON (415). The body is {}; anything else is 400"; ADR 0006 § Docs, C5-8 ("sameHost is ownerOrAdmin\'s last check. On the POST, 415 and 400 follow it")]', async () => {
  const s = scene();
  const p = [];
  for (const c of [
    { name: 'a stranger posting text/plain', as: 'stranger', ro: { contentType: 'text/plain', body: 'x' }, status: 403, error: E403 },
    { name: 'the owner from another site posting text/plain and []', as: 'owner', ro: { origin: 'other', contentType: 'text/plain', body: [] }, status: 403, error: EXSITE },
    { name: 'the owner posting text/plain with { a: 1 }', as: 'owner', ro: { contentType: 'text/plain', body: { a: 1 } }, status: 415 },
    { name: 'the owner posting JSON { a: 1 }', as: 'owner', ro: { body: { a: 1 } }, status: 400 },
  ]) {
    const m = s.mark();
    const r = await s.run(c.as, c.ro);
    p.push(...statusProblems(c.name, r, c.status));
    if (c.error && r.status === c.status && !refusedBody(r.body, c.error)) p.push(`${c.name}: error should be ${show(c.error)}; the body is ${show(r.body)}`);
    if (!c.error && r.status === c.status && !(r.body && r.body.success === false)) p.push(`${c.name}: the body should carry success: false; it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  const ok = await s.run('admin', { contentType: 'application/json; charset=utf-8' });
  p.push(...statusProblems('an admin posting {} as application/json; charset=utf-8', ok, 200));
  report(p);
});

test('PX5: Run answers 415 when the body is not JSON (text/plain, no content type) and 400 for any body but {} ({ a: 1 }, [], null, { targets: [] }, "run", 1), touching nothing each time; then {} lines up a pass [ADR tagging-edges/0006 D6 "then requires JSON (415). The body is {}; anything else is 400", D1 "Refusals happen outside the chain"]', async () => {
  const s = scene();
  const p = [];
  const rows = [
    { name: 'text/plain', ro: { contentType: 'text/plain' }, status: 415 },
    { name: 'no content type', ro: { contentType: null }, status: 415 },
    ...[{ a: 1 }, [], null, { targets: [] }, 'run', 1].map((body) => ({ name: `the body ${show(body)}`, ro: { body }, status: 400 })),
  ];
  for (const c of rows) {
    const m = s.mark();
    const r = await s.run('owner', c.ro);
    p.push(...statusProblems(c.name, r, c.status));
    if (r.status === c.status && !(r.body && r.body.success === false)) p.push(`${c.name}: the body should carry success: false; it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  const ok = await s.run('owner', { body: {} });
  p.push(...statusProblems('the body {}', ok, 200));
  report(p);
});

test('PX6: with the task queue off — the flag off, or queueHealth() "not-ready" or "off" — Run is refused 503 { code: "QUEUE_UNAVAILABLE" } outside the chain: only the two queue checks are consulted, no key is minted, nothing is read from or added to the queue, and no record is written; with the queue ready the same request lines up a pass [AC-1 "When the task queue is unavailable, the server refuses plainly and starts nothing"; ADR tagging-edges/0006 D6 "Off-queue refusal, outside the chain", D2 queueHealth, D14]', async () => {
  await cases([
    { name: 'the flag off', set: (w) => { w.enabled = false; } },
    { name: 'queueHealth "not-ready"', set: (w) => { w.health = 'not-ready'; } },
    { name: 'queueHealth "off"', set: (w) => { w.health = 'off'; } },
  ], async (c) => {
    const s = scene();
    c.set(s.world);
    const m = s.mark();
    const r = await s.run('owner');
    const d = s.since(m);
    const p = statusProblems('Run', r, 503, ' { code: "QUEUE_UNAVAILABLE" }');
    if (!r.body || r.body.code !== 'QUEUE_UNAVAILABLE' || r.body.success === true) p.push(`the answer should carry code "QUEUE_UNAVAILABLE" and not success: true; it is ${show(r.body)}`);
    const other = [...new Set(d.names.filter((n) => n !== 'taskQueueEnabled' && n !== 'queueHealth'))];
    if (other.length) p.push(`only taskQueueEnabled and queueHealth may be consulted before this refusal (${adr('D6')}); it also called ${show(other)}`);
    if (!d.names.length) p.push('neither taskQueueEnabled nor queueHealth was consulted, so the refusal did not come from the queue checks');
    if (d.queue.length || d.writes || d.keys.length) p.push(`nothing may be read, added, minted or written; queue calls ${show(d.queue)}, record writes ${d.writes}, keys ${show(d.keys)}`);
    s.world.enabled = true;
    s.world.health = 'ready';
    const ok = await s.run('owner');
    p.push(...statusProblems('the same Run with the queue ready', ok, 200));
    report(p);
  });
});

test('PX6b: the queue checks are answered before the chain — while the owner\'s Run holds the chain (its add hangs), an admin\'s Run with the flag off, and again with queueHealth "not-ready", each answers 503 { code: "QUEUE_UNAVAILABLE" } within 800 ms, consulting only taskQueueEnabled and queueHealth and reading, adding, minting and writing nothing; once the hang is released the held Run lines up its pass [ADR tagging-edges/0006 D6 "Off-queue refusal, outside the chain. If taskQueueEnabled() is false, or queueHealth() !== ready, answer 503", D1 "Refusals happen outside the chain. Auth, body validation and the queue\'s being off are answered before joining"; AC-1 "When the task queue is unavailable, the server refuses plainly and starts nothing"]', async () => {
  const s = scene({ timers: { stepMs: 5000 } });
  s.world.queue.inject('add', { hang: true });
  const heldRun = s.run('owner');
  heldRun.catch(() => {});
  const p = [];
  const late = [];
  try {
    await H.waitFor(() => s.world.queue.calls.some((c) => c.method === 'add'), { timeoutMs: 2000, what: 'the owner\'s Run to reach its add, so that it holds the chain' });
    for (const c of [
      { name: 'the flag off', set: (w) => { w.enabled = false; } },
      { name: 'queueHealth "not-ready"', set: (w) => { w.health = 'not-ready'; } },
    ]) {
      c.set(s.world);
      const m = s.mark();
      const pending = s.run('admin');
      pending.catch(() => {});
      const r = await Promise.race([pending, H.sleep(800).then(() => null)]);
      const d = s.since(m);
      s.world.enabled = true;
      s.world.health = 'ready';
      if (r === null) {
        late.push(pending);
        p.push(`${c.name}: no answer within 800 ms while the owner's Run held the chain — the queue checks waited behind the chain instead of answering before joining it (${adr('D6')} "Off-queue refusal, outside the chain"; D1 "Refusals happen outside the chain")`);
        continue;
      }
      p.push(...statusProblems(c.name, r, 503, ' { code: "QUEUE_UNAVAILABLE" }'));
      if (!r.body || r.body.code !== 'QUEUE_UNAVAILABLE' || r.body.success === true) p.push(`${c.name}: the answer should carry code "QUEUE_UNAVAILABLE" and not success: true; it is ${show(r.body)}`);
      const other = [...new Set(d.names.filter((n) => n !== 'taskQueueEnabled' && n !== 'queueHealth'))];
      if (other.length) p.push(`${c.name}: only taskQueueEnabled and queueHealth may be consulted before this refusal (${adr('D6')}); it also called ${show(other)}`);
      if (!d.names.length) p.push(`${c.name}: neither taskQueueEnabled nor queueHealth was consulted, so the refusal did not come from the queue checks`);
      if (d.queue.length || d.writes || d.renames || d.keys.length) p.push(`${c.name}: nothing may be read, added, minted or written; queue calls ${show(d.queue)}, record writes ${d.writes}, renames ${d.renames}, keys ${show(d.keys)}`);
    }
  } finally {
    s.world.queue.releaseHangs();
  }
  const held = await heldRun;
  const K = held.body && held.body.key;
  if (held.status !== 200 || !held.body || held.body.linedUp !== true || typeof K !== 'string') p.push(`the owner's held Run should line up its pass once the hang is released (so the chain was held by a Run that works); it answered ${showRes(held)}`);
  else if (s.world.queue.state(K) !== 'waiting') p.push(`the owner's job ${K} should be waiting; it is ${show(s.world.queue.state(K))}`);
  for (const x of late) await x.catch(() => {});
  report(p);
});

test('PX7: when the chain step\'s fresh snapshot cannot read the queue — getActive rejects, or getDelayed hangs past the step\'s deadline — Run answers 503 { code: "QUEUE_UNAVAILABLE" }: "cannot tell" is never read as "nothing there", so nothing is added and nothing is recorded [AC-1; AC-2 "When the server cannot tell whether a pass is waiting"; ADR tagging-edges/0006 D1 "A time-out or a throw counts as cannot tell for that step, never as nothing there", D5 queue "read-failed", D6 step 1 "If queue !== ok → 503 QUEUE_UNAVAILABLE"]', async () => {
  await cases([
    { name: 'getActive rejects with EIO', set: (w) => w.queue.inject('getActive', { error: 'EIO' }) },
    { name: 'getDelayed hangs', set: (w) => w.queue.inject('getDelayed', { hang: true }) },
  ], async (c) => {
    const s = scene();
    c.set(s.world);
    const m = s.mark();
    const r = await s.run('admin');
    const d = s.since(m);
    const p = statusProblems('Run', r, 503);
    if (!r.body || r.body.code !== 'QUEUE_UNAVAILABLE') p.push(`the answer should carry code "QUEUE_UNAVAILABLE"; it is ${show(r.body)}`);
    if (!d.queue.some((q) => q === 'getActive' || q === 'getDelayed')) p.push(`the snapshot never read the queue (calls ${show(d.queue)}), so this did not test a failed read`);
    if (d.adds.length) p.push(`nothing may be added; adds ${show(d.adds)}`);
    const rec = s.record_();
    if (rec && Object.values(rec.passes || {}).some((e) => e && e.start)) p.push(`no start may be recorded; the record is ${show(rec)}`);
    report(p);
  });
});

test('PX8: while a pass is busy, Run is refused 409 { code: "pass-busy", busy } and nothing new is lined up or recorded — a running pass, a lined-up pass waiting, one waiting behind other heavy work (picked up, before its lock), and a due scheduled run on the seed id that waits; busy lists the pass with its key and state ("behind": "heavy-work" for the one waiting on the lock), and carries no who: each item is an object holding only D12\'s item members (key, jobId, state, since, behind, runId, stopAskedAt, startRecorded, confirmation), no "who" member, and not the starter\'s shortened key [AC-1 "When a pass is busy, the server refuses plainly … That holds for a scheduled run whose time has come and that is waiting"; AC-5 "Who may read it"; ADR tagging-edges/0006 D6 step 1 "If busy → 409 {code: pass-busy, busy: items}; the items carry no who", D5 classification and "Each item is {key, jobId, state, since, behind, runId, stopAskedAt}", D12 "each {key, jobId, state, since, behind, runId, stopAskedAt, startRecorded, confirmation}"]', async () => {
  const RUNNING = H.lineUpKey(70);
  await cases([
    {
      name: 'a running pass',
      prep: async (s) => { s.world.startPass({ jobId: RUNNING }); return { key: RUNNING, state: 'running' }; },
    },
    {
      name: 'a lined-up pass waiting',
      prep: async (s) => { const r = await s.run('owner'); s.world.clock.advance(SEC); return { key: r.body && r.body.key, state: 'waiting' }; },
    },
    {
      name: 'a pass waiting behind other heavy work',
      prep: async (s) => {
        const r = await s.run('owner');
        const job = s.world.queue.pickUp();
        const g = await s.ctl.gate.beforeAcquire(job);
        assert(g === 'go', `gate.beforeAcquire should answer "go" for a lined-up job (${adr('D3')}); it answered ${show(g)}`);
        s.world.clock.advance(SEC);
        return { key: r.body && r.body.key, state: 'waiting', behind: 'heavy-work' };
      },
    },
    {
      name: 'a due scheduled run on the seed id',
      prep: async (s) => ({ key: s.world.queue.plantScheduled({ millis: T0 - MIN }), state: 'waiting' }),
    },
  ], async (c) => {
    const s = scene();
    const want = await c.prep(s);
    const m = s.mark();
    const r = await s.run('admin');
    const d = s.since(m);
    const p = statusProblems('Run while busy', r, 409, ' pass-busy');
    if (!r.body || r.body.code !== 'pass-busy' || r.body.success === true) p.push(`the answer should carry code "pass-busy" (${adr('D14')}); it is ${show(r.body)}`);
    const busy = r.body && r.body.busy;
    if (!Array.isArray(busy)) p.push(`the answer should list busy as an array (${adr('D6')}); it is ${show(busy)}`);
    else {
      const item = busy.find((i) => i && i.key === want.key);
      if (!item) p.push(`busy should list ${show(want.key)}; it is ${show(busy)}`);
      else {
        if (item.state !== want.state) p.push(`${show(want.key)} should be ${want.state}; it is ${show(item.state)}`);
        if (want.behind && item.behind !== want.behind) p.push(`${show(want.key)} should wait behind ${show(want.behind)} (${adr('D5')}); it is ${show(item.behind)}`);
      }
      if (busy.some((i) => i && has(i, 'who'))) p.push(`no busy item may carry who (${adr('D6')}); busy is ${show(busy)}`);
      for (const i of busy) {
        if (!i || typeof i !== 'object' || Array.isArray(i)) { p.push(`every busy item should be an object (${adr('D5')}); busy is ${show(busy)}`); continue; }
        const extra = Object.keys(i).filter((k) => !BUSY_ITEM_MEMBERS.includes(k));
        if (extra.length) p.push(`the busy item ${show(i.key)} carries ${show(extra)}, outside D5's and D12's item members ${show(BUSY_ITEM_MEMBERS)} — a member under any other name could carry who (${adr('D6')} "the items carry no who"; § Constraints: the four kinds stay indistinguishable to a signed-out reader); the item is ${show(i)}`);
      }
    }
    const text = JSON.stringify(r.body || null);
    if (text.includes(OWNER_KEY) || text.includes(ADMIN_KEY)) p.push(`the 409 carries a shortened key of who started a pass: ${text}`);
    if (d.adds.length || d.writes) p.push(`nothing new may be lined up or recorded; adds ${show(d.adds)}, record writes ${d.writes}`);
    report(p);
  });
});

test('PX9: two Runs at once — the owner\'s and an admin\'s, sent without waiting — give exactly one 200 and one 409 pass-busy, and exactly one job is added: the second request never joins the first, and is never answered as lined up [AC-1; Background "A second request can quietly join a pass"; ADR tagging-edges/0006 D1 (one chain), D2 "Nothing ever joins", D6]', async () => {
  const s = scene();
  const m = s.mark();
  const [a, b] = await Promise.all([s.run('owner'), s.run('admin')]);
  const d = s.since(m);
  const statuses = [a.status, b.status].sort();
  const p = [];
  if (exact(statuses) !== exact([200, 409])) p.push(`the two answers should be one 200 and one 409; they are ${showRes(a)} and ${showRes(b)}`);
  const refused = a.status === 409 ? a : b;
  if (refused.status === 409 && (!refused.body || refused.body.code !== 'pass-busy')) p.push(`the 409 should carry pass-busy; it is ${show(refused.body)}`);
  if (d.adds.length !== 1) p.push(`exactly one job should be added; adds ${show(d.adds)}`);
  if (s.world.queue.joins.length) p.push(`an add joined an existing job (BullMQ's silent join): ${show(s.world.queue.joins)}`);
  report(p);
});

test('PX10: a Run that cannot be recorded is refused 500 { code: "record-unavailable" } and changes nothing — the record gives a read error (EIO), or its write throws ENOSPC (then cause "ENOSPC", through allowErrorCode) — no job is added and the record\'s bytes are unchanged; once the record is healed a Run lines up a pass [AC-5 "When the server cannot record an action: a Run is refused and changes nothing … the history recorded before it survives"; ADR tagging-edges/0006 D6 step 2 "If the record is unreadable, or the write fails → 500 {code: record-unavailable}. Nothing has been added", D11, D14 "for example 500 {code: record-unavailable, cause: ENOSPC}"]', async () => {
  const OLD = H.lineUpKey(40);
  const before = H.recordFile({
    passes: { [OLD]: H.recordEntry({ jobId: OLD, start: { at: iso(T0 - HOUR), who: H.whoOf('owner') } }) },
    history: [H.historyLine('start', OLD, iso(T0 - HOUR), H.whoOf('owner'))],
  });
  await cases([
    { name: 'a read error', set: (w) => w.record.failReads('EIO'), cause: null },
    { name: 'a write that throws ENOSPC', set: (w) => w.record.failWrites('ENOSPC'), cause: 'ENOSPC' },
  ], async (c) => {
    const s = scene({ record: { record: before } });
    const bytes = s.world.record.bytes();
    c.set(s.world);
    const m = s.mark();
    const r = await s.run('owner');
    const d = s.since(m);
    const p = statusProblems('Run', r, 500, ' record-unavailable');
    if (!r.body || r.body.code !== 'record-unavailable' || r.body.success === true) p.push(`the answer should carry code "record-unavailable" (${adr('D14')}); it is ${show(r.body)}`);
    if (c.cause && (!r.body || r.body.cause !== allowErrorCode(c.cause))) p.push(`the answer's cause should be ${show(allowErrorCode(c.cause))} (${adr('D14')}); it is ${show(r.body && r.body.cause)}`);
    if (d.adds.length) p.push(`nothing may be added; adds ${show(d.adds)}`);
    if (s.world.record.bytes() !== bytes) p.push(`the record's bytes changed: ${show(bytes)} → ${show(s.world.record.bytes())}`);
    s.world.record.heal();
    s.world.clock.advance(SEC);
    const ok = await s.run('owner');
    p.push(...statusProblems('a Run once the record is healed', ok, 200));
    report(p);
  });
});

test('PX11: a Run whose add fails is never answered as lined up and leaves no start behind — an add that hangs past the deadline answers 503 { code: "QUEUE_UNAVAILABLE" }; an add that rejects (ECONNRESET) answers 503 QUEUE_UNAVAILABLE or 500 { code: "error", cause: "ECONNRESET" }; either way the record has no start and no history line for the minted key [AC-1 "It is never answered as lined up when no pass will run"; ADR tagging-edges/0006 D6 step 3 "remove the start entry and its history line … answer 503 QUEUE_UNAVAILABLE, or 500 {code: error, cause}"; review-named case "A Run whose add times out leaves no start in passes or history"]', async () => {
  await cases([
    { name: 'an add that hangs', set: (w) => w.queue.inject('add', { hang: true }), ok: (b, r) => r.status === 503 && b && b.code === 'QUEUE_UNAVAILABLE', want: '503 QUEUE_UNAVAILABLE' },
    {
      name: 'an add that rejects with ECONNRESET',
      set: (w) => w.queue.inject('add', { error: 'ECONNRESET' }),
      ok: (b, r) => (r.status === 503 && b && b.code === 'QUEUE_UNAVAILABLE') || (r.status === 500 && b && b.code === 'error' && b.cause === allowErrorCode('ECONNRESET')),
      want: '503 QUEUE_UNAVAILABLE, or 500 { code: "error", cause: "ECONNRESET" }',
    },
  ], async (c) => {
    const s = scene();
    c.set(s.world);
    const m = s.mark();
    const r = await s.run('owner');
    const d = s.since(m);
    const p = [];
    if (!c.ok(r.body, r)) p.push(`Run should answer ${c.want}; it answered ${showRes(r)}`);
    if (!d.adds.length) p.push('no add was tried, so this did not test a failed add');
    const keys = [...new Set([...d.keys, ...d.adds.filter(Boolean)])];
    const rec = s.record_();
    for (const k of keys) {
      const e = entryOf(rec, k);
      if (e && e.start) p.push(`the record still holds a start for ${show(k)}: ${show(e)}`);
      if (historyOf(rec).some((h) => h && h.key === k)) p.push(`the history still holds a line for ${show(k)}: ${show(historyOf(rec))}`);
    }
    report(p);
  });
});

test('PX12: a dependency that throws inside Run\'s or the run-task delegate\'s try answers 500 { code: "error", cause: allowErrorCode(err.code) }, never a rejection — taskQueueEnabled throwing EACCES gives cause "EACCES"; queueHealth throwing an odd code gives cause "error", and the odd code\'s text is in no answer [ADR tagging-edges/0006 D6 "everything that calls a dep (the queue checks included) runs inside the handler\'s try/catch. The catch answers 500 with {code: error, cause: allowErrorCode(err && err.code)}", D7, D14 "Thrown codes go through ADR 0005\'s allowErrorCode"]', async () => {
  const thrower = (code) => () => { throw Object.assign(new Error(`connect ECONNREFUSED bolt://${ODD_CODE} (${code})`), { code }); };
  await cases([
    { name: 'Run, taskQueueEnabled throws EACCES', route: 'run', dep: 'taskQueueEnabled', code: 'EACCES' },
    { name: 'Run, queueHealth throws an odd code', route: 'run', dep: 'queueHealth', code: ODD_CODE },
    { name: 'run-task, taskQueueEnabled throws EACCES', route: 'runTask', dep: 'taskQueueEnabled', code: 'EACCES' },
    { name: 'run-task, queueHealth throws an odd code', route: 'runTask', dep: 'queueHealth', code: ODD_CODE },
  ], async (c) => {
    const s = scene();
    const deps = { ...s.deps, [c.dep]: thrower(c.code) };
    const r = await s[c.route](c.route === 'runTask' ? 'local' : 'owner', { deps });
    const p = statusProblems(c.name, r, 500);
    p.push(...membersProblems(c.name, r.body, { code: 'error', cause: allowErrorCode(c.code) }));
    report(p);
  });
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX13–PX19 — the run-task delegate, handleRunTaskForPass (D7)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX13: a direct local call (req.localTrusted, no session, no Origin, no body, no content type) through the run-task delegate lines up a pass — 200 { success: true, message: "A gap-filling pass was lined up.", queued: true, jobId: key } with key the new job\'s LINEUP_ID-shaped id — and the record holds its start with who exactly { kind: "local" } [AC-4 "Requests the app already trusts as direct local calls stay exempt from the who-may check"; AC-5 "a local call, for a start from a direct local request"; ADR tagging-edges/0006 D7 "req.localTrusted gives {kind: local}", "Its answers carry message … 200 {success: true, message: A gap-filling pass was lined up., queued: true, jobId: key}"]', async () => {
  const s = scene();
  const m = s.mark();
  const r = await s.runTask('local');
  const d = s.since(m);
  const p = statusProblems('run-task, a local call', r, 200);
  p.push(...membersProblems('run-task, a local call', r.body, { success: true, message: LINED_UP_MESSAGE, queued: true }));
  const key = r.body && r.body.jobId;
  if (typeof key !== 'string' || !LINEUP_ID.test(key)) p.push(`jobId should be the new key, matching ${LINEUP_ID}; it is ${show(key)}`);
  if (d.adds.length !== 1 || d.adds[0] !== key) p.push(`exactly one job should be added under jobId; adds ${show(d.adds)}`);
  const e = entryOf(s.record_(), key);
  if (!e || !e.start || exact(e.start.who) !== exact({ kind: 'local' })) p.push(`the start's who should be exactly { kind: "local" } (${adr('D7')}, D11: key only for the owner or an admin); the entry is ${show(e)}`);
  report(p);
});

test('PX14: the owner and an admin through the run-task delegate are recorded with their role and shortened key, and no JSON is required — no content type and no body, text/plain, and an empty JSON body each line up a pass with D7\'s 200 [AC-4, AC-5; ADR tagging-edges/0006 D7 "Otherwise ownerOrAdmin(req, d) gives {kind: role, key}", "No JSON is required, because the Task Explorer posts no body"]', async () => {
  await cases([
    { name: 'the owner, no content type and no body', as: 'owner', ro: {}, who: H.whoOf('owner') },
    { name: 'an admin, no content type and no body', as: 'admin', ro: {}, who: H.whoOf('admin') },
    { name: 'the owner, text/plain', as: 'owner', ro: { contentType: 'text/plain', body: 'run it' }, who: H.whoOf('owner') },
    { name: 'an admin, JSON {}', as: 'admin', ro: { contentType: 'application/json', body: {} }, who: H.whoOf('admin') },
  ], async (c) => {
    const s = scene();
    const r = await s.runTask(c.as, c.ro);
    const p = statusProblems(c.name, r, 200);
    p.push(...membersProblems(c.name, r.body, { success: true, message: LINED_UP_MESSAGE, queued: true }));
    const e = entryOf(s.record_(), r.body && r.body.jobId);
    if (!e || !e.start || exact(e.start.who) !== exact(c.who)) p.push(`the start's who should be ${show(c.who)}; the entry is ${show(e)}`);
    report(p);
  });
});

test('PX15: the run-task delegate\'s own refusals carry ownerOrAdmin\'s sentence and a message, and touch nothing — signed out (not local) 401; a signed-in stranger 403; a session that is not authenticated 403; an owner key that OWNER_RE rejects (upper case, where the middleware\'s check would admit it) 403; the owner from another site 403 cross-site; a local call with another site\'s Origin, and a local call with Origin null, 403 cross-site (sameHost applies to a local call too); a local call with no Origin then lines up a pass [AC-4 "a request from another site"; ADR tagging-edges/0006 D7 "Its own 401 and role 403 answer only where the two checks disagree", "sameHost applies to a local call too", "the delegate\'s own 401 and 403 (the cross-site 403 among them), each with a message"]', async () => {
  const s = scene();
  const p = [];
  const UPPER = OWNER.toUpperCase();
  for (const c of [
    { name: 'signed out, not local', as: 'signed-out', status: 401, error: E401 },
    { name: 'a signed-in stranger', as: 'stranger', status: 403, error: E403 },
    { name: 'a session that is not authenticated', as: 'unauthenticated', status: 403, error: E403 },
    { name: 'an owner key that OWNER_RE rejects', as: 'owner', status: 403, error: E403, upper: true },
    { name: 'the owner from another site', as: 'owner', ro: { origin: 'other' }, status: 403, error: EXSITE },
    { name: 'a local call from another site', as: 'local', ro: { origin: 'other' }, status: 403, error: EXSITE },
    { name: 'a local call with Origin null', as: 'local', ro: { origin: 'null' }, status: 403, error: EXSITE },
  ]) {
    const req = H.passReq(c.as, { path: PATHS.runTask, query: { taskName: TASK }, contentType: null, body: undefined, origin: c.as === 'local' ? undefined : 'same', ...(c.ro || {}) });
    if (c.upper) { req.session.pubkey = UPPER; s.world.owner = UPPER; }
    const m = s.mark();
    const r = await call(s.pass.handleRunTaskForPass, req, s.deps, `run-task, ${c.name}`);
    s.world.owner = OWNER;
    p.push(...statusProblems(c.name, r, c.status));
    if (r.status === c.status && !refusedBody(r.body, c.error)) p.push(`${c.name}: the body should carry success false and error ${show(c.error)}; it is ${show(r.body)}`);
    if (!r.body || typeof r.body.message !== 'string' || !r.body.message.trim()) p.push(`${c.name}: the answer should carry a message for the Task Explorer's modal (${adr('D7')}); it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  const ok = await s.runTask('local');
  p.push(...statusProblems('the paired local call with no Origin', ok, 200));
  report(p);
});

test('PX16: while a pass is busy the run-task delegate is refused 409 { success: false, code: "pass-busy", error, message: "A pass is already waiting or running. Nothing new was lined up." } and nothing new is lined up or recorded — a running pass, and a pass waiting after the owner\'s Run [AC-4 "it refuses plainly while a pass is busy … a refused request records nothing"; AC-1; ADR tagging-edges/0006 D7 "409 {success: false, code: pass-busy, error, message: …}"]', async () => {
  await cases([
    { name: 'a running pass', prep: async (s) => { s.world.startPass({ jobId: H.lineUpKey(71) }); } },
    { name: 'a pass waiting after the owner\'s Run', prep: async (s) => { await s.run('owner'); s.world.clock.advance(SEC); } },
  ], async (c) => {
    const s = scene();
    await c.prep(s);
    const m = s.mark();
    const r = await s.runTask('admin');
    const d = s.since(m);
    const p = statusProblems('run-task while busy', r, 409);
    p.push(...membersProblems('run-task while busy', r.body, { success: false, code: 'pass-busy', message: BUSY_MESSAGE }));
    if (!r.body || typeof r.body.error !== 'string') p.push(`the answer should carry error beside code and message (${adr('D7')}); it is ${show(r.body)}`);
    if (d.adds.length || d.writes) p.push(`nothing new may be lined up or recorded; adds ${show(d.adds)}, record writes ${d.writes}`);
    report(p);
  });
});

test('PX17: the run-task delegate\'s other refusals carry code, error and a message, and add nothing — 503 QUEUE_UNAVAILABLE with the flag off (this pass no longer takes the legacy direct spawn), with queueHealth "not-ready", and when the snapshot\'s read fails; 500 record-unavailable when the record gives a read error, and with cause "ENOSPC" when its write throws [AC-1, AC-4; ADR tagging-edges/0006 D7 "503 QUEUE_UNAVAILABLE, 500 record-unavailable … each with a message", "With the flag off this pass is refused, 503 QUEUE_UNAVAILABLE"]', async () => {
  await cases([
    { name: 'the flag off', set: (w) => { w.enabled = false; }, status: 503, code: 'QUEUE_UNAVAILABLE' },
    { name: 'queueHealth "not-ready"', set: (w) => { w.health = 'not-ready'; }, status: 503, code: 'QUEUE_UNAVAILABLE' },
    { name: 'a failed queue read', set: (w) => w.queue.inject('getActive', { error: 'EIO' }), status: 503, code: 'QUEUE_UNAVAILABLE' },
    { name: 'a record read error', set: (w) => w.record.failReads('EIO'), status: 500, code: 'record-unavailable' },
    { name: 'a record write that throws ENOSPC', set: (w) => w.record.failWrites('ENOSPC'), status: 500, code: 'record-unavailable', cause: 'ENOSPC' },
  ], async (c) => {
    const s = scene();
    c.set(s.world);
    const m = s.mark();
    const r = await s.runTask('owner');
    const d = s.since(m);
    const p = statusProblems(c.name, r, c.status);
    p.push(...membersProblems(c.name, r.body, { success: false, code: c.code, ...(c.cause ? { cause: allowErrorCode(c.cause) } : {}) }));
    if (!r.body || typeof r.body.error !== 'string' || typeof r.body.message !== 'string' || !r.body.message.trim()) p.push(`${c.name}: the answer should carry error and a message (${adr('D7')}); it is ${show(r.body)}`);
    if (d.adds.length) p.push(`${c.name}: nothing may be added; adds ${show(d.adds)}`);
    report(p);
  });
});

test('PX18: just after a pass ends — its process has exited and written its report, its job still active in the finishing window — Run and the run-task delegate each line up a NEW pass and answer 200 with the new key, which waits behind the ending job: never answered as lined up when no pass will run [AC-1 "Just after a pass ends … It is never answered as lined up when no pass will run"; ledger 2026-09-28-confirm-route-joins-finishing-job; ADR tagging-edges/0006 D5 ("ending": not busy, and not listed), D6 "The finishing window", D7 "the same chain step as D6"]', async () => {
  await cases([
    { name: 'Run', send: (s) => s.run('admin'), keyOf: (b) => b && b.key },
    { name: 'the run-task delegate', send: (s) => s.runTask('admin'), keyOf: (b) => b && b.jobId },
  ], async (c) => {
    const s = scene();
    const first = await s.run('owner');
    const K = first.body && first.body.key;
    assert(first.status === 200 && typeof K === 'string', `the owner's Run should line up the first pass; it answered ${showRes(first)}`);
    const job = s.world.queue.pickUp();
    assert(job && job.id === K, `the first job should be picked up; got ${show(job && job.id)}`);
    const g1 = await s.ctl.gate.beforeAcquire(job);
    const g2 = await s.ctl.gate.afterAcquire(job);
    assert(g1 === 'go' && g2 === 'go', `the gate should let the first job run (${adr('D3')}); it answered ${show([g1, g2])}`);
    s.world.startPass({ jobId: K });
    s.world.clock.advance(3 * SEC);
    s.world.endPass({ state: 'done' });
    s.world.clock.advance(SEC);
    const r = await c.send(s);
    const p = statusProblems(c.name, r, 200);
    const K2 = c.keyOf(r.body);
    if (typeof K2 !== 'string' || !LINEUP_ID.test(K2) || K2 === K) p.push(`the answer should name a new key, not ${show(K)}; it is ${show(r.body)}`);
    if (s.world.queue.state(K) !== 'active') p.push(`the ending job should still be active (the finishing window); it is ${show(s.world.queue.state(K))}`);
    if (typeof K2 === 'string' && s.world.queue.state(K2) !== 'waiting') p.push(`the new job should be waiting behind the ending one; it is ${show(s.world.queue.state(K2))}`);
    report(p);
  });
});

test('PX19: the run-task delegate refuses a busy pass before recording anything even for a direct local call, and a refused local call records no start [AC-4 "A refused request records nothing"; AC-5 "Only what happened is recorded. A request that lines up no new pass records no start"; ADR tagging-edges/0006 D7, D6 step 1]', async () => {
  const s = scene();
  s.world.startPass({ jobId: H.lineUpKey(72) });
  const m = s.mark();
  const r = await s.runTask('local');
  const d = s.since(m);
  const p = statusProblems('run-task, a local call while busy', r, 409);
  if (!r.body || r.body.code !== 'pass-busy') p.push(`the answer should carry pass-busy; it is ${show(r.body)}`);
  if (d.writes || d.adds.length) p.push(`a refused local call records and lines up nothing; record writes ${d.writes}, adds ${show(d.adds)}`);
  if (!d.names.length) p.push('the delegate consulted nothing, so the busy check never ran');
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX20–PX26 — Stop (D9)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX20: every refused caller of Stop gets ownerOrAdmin\'s answer and touches nothing (signed out 401, a session not authenticated 403, a stranger 403, the owner from another site 403 cross-site, an admin with Origin null 403 cross-site, a direct local call 401), the checks run who → site → JSON → body (a stranger posting text/plain 403; the owner posting text/plain 415; the owner posting { targets: [] } 400), and the owner\'s valid Stop in the same world then reaches the chain [AC-4 "It accepts a Run or a Stop only from a signed-in owner or admin … changes and records nothing"; ADR tagging-edges/0006 D9 "The handler re-checks ownerOrAdmin, then requires JSON (415), then validates the body (400)"]', async () => {
  const s = scene();
  const p = [];
  const target = [{ key: H.lineUpKey(9), state: 'waiting' }];
  for (const c of PANEL_REFUSALS) {
    const m = s.mark();
    const r = await s.stop(c.as, target, { origin: c.origin });
    p.push(...statusProblems(c.name, r, c.status));
    if (r.status === c.status && !refusedBody(r.body, c.error)) p.push(`${c.name}: the body should carry success false and error ${show(c.error)}; it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  for (const c of [
    { name: 'a stranger posting text/plain', as: 'stranger', ro: { contentType: 'text/plain', body: 'stop' }, status: 403 },
    { name: 'the owner posting text/plain', as: 'owner', ro: { contentType: 'text/plain', body: { targets: [] } }, status: 415 },
    { name: 'the owner posting { targets: [] }', as: 'owner', ro: { body: { targets: [] } }, status: 400 },
  ]) {
    const m = s.mark();
    const r = await s.stop(c.as, target, c.ro);
    p.push(...statusProblems(c.name, r, c.status));
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  const m = s.mark();
  const ok = await s.stop('owner', target);
  const d = s.since(m);
  if (ok.status === 401 || ok.status === 403 || ok.status === 415 || ok.status === 400 || !d.names.length) p.push(`the paired owner's valid Stop should reach the chain (it reads the snapshot); it answered ${showRes(ok)} and called ${show(d.names)}`);
  report(p);
});

test('PX21: Stop\'s body is { targets: [{ key, state }] } with one to fifty entries, keys distinct as they are (no trimming, case folding or normalisation), each key a string of 1 to 256 UTF-16 code units with no control character (U+0000–U+001F, U+007F–U+009F) and no U+2028 or U+2029, and state "waiting" or "running" — every other body is 400, its sentence naming the 256 rule and not the old 120, and touches nothing; on the accepting side of each rule (one target; fifty; a 1-unit and a 256-unit key; 128 emoji; "manual run", "job/1", "__proto__", "constructor"; a space, a tilde, U+00A0, U+2027, U+202A, a format character, a lone surrogate and characters the old rule refused; keys that differ only by case, a trailing space or normalisation; fifty 256-unit keys; the seed scheduled id; a legacy key; a run: key) the request reaches the chain and, with nothing busy, answers 409 nothing-to-stop [ADR tagging-edges/0006 Amendment 1 § A (D9\'s body rule, as amended: "A key is a string of 1 to 256 characters with no forbidden character", its Boundaries, "Keys are distinct by ===", "The 400\'s sentence names the new rule"), D2 (the seed id, the legacy key), D5 (run: keys), D14]', async () => {
  const K = H.lineUpKey(1);
  const ch = (cp) => String.fromCharCode(cp);
  const EMOJI = String.fromCodePoint(0x1F600); // two UTF-16 code units
  const t = (key, state = 'waiting') => ({ key, state });
  const many = (n) => Array.from({ length: n }, (_, i) => t(H.lineUpKey(100 + i)));
  const repeatTo = (s, n) => s.repeat(Math.ceil(n / s.length)).slice(0, n);
  const long256 = repeatTo(KEY_CHARS, 256);
  // Amendment 1 § A "The forbidden characters": C0, DEL, C1 (Unicode's Cc) and the two line terminators, each at a
  // boundary of its range, plus \t, \n, \r and U+0085, anywhere in the key.
  const FORBIDDEN = [0x0000, 0x0009, 0x000A, 0x000D, 0x001F, 0x007F, 0x0080, 0x0085, 0x009F, 0x2028, 0x2029];
  const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  const bad = [
    { name: 'no targets', body: {} },
    { name: 'targets an object', body: { targets: { key: K, state: 'waiting' } } },
    { name: 'targets a string', body: { targets: K } },
    { name: 'targets null', body: { targets: null } },
    { name: 'no target', body: { targets: [] } },
    { name: '51 targets', body: { targets: many(51) } },
    { name: 'the same key twice', body: { targets: [t(K), t(K, 'running')] } },
    { name: 'the same odd key twice', body: { targets: [t('manual run'), t('manual run', 'running')] } },
    { name: 'a target that is null', body: { targets: [null] } },
    { name: 'a target that is a string', body: { targets: [K] } },
    { name: 'a target that is an array', body: { targets: [[K, 'waiting']] } },
    { name: 'a key that is a number', body: { targets: [t(42)] } },
    { name: 'a key that is true', body: { targets: [t(true)] } },
    { name: 'a key that is an object', body: { targets: [t({ id: K })] } },
    { name: 'a key that is an array', body: { targets: [t([K])] } },
    { name: 'a key that is null', body: { targets: [t(null)] } },
    { name: 'no key', body: { targets: [{ state: 'waiting' }] } },
    { name: 'an empty key (0 units)', body: { targets: [t('')] } },
    { name: 'a 257-unit key', body: { targets: [t(`${long256}x`)] } },
    { name: '128 emoji and one more character (257 units)', body: { targets: [t(`${EMOJI.repeat(128)}x`)] } },
    { name: '129 emoji (258 units)', body: { targets: [t(EMOJI.repeat(129))] } },
    { name: 'a valid target beside a 257-unit key', body: { targets: [t(K), t(`${long256}x`)] } },
    ...FORBIDDEN.flatMap((cp) => [
      { name: `a key starting with ${hex(cp)}`, body: { targets: [t(`${ch(cp)}${K}`)] } },
      { name: `a key holding ${hex(cp)} inside`, body: { targets: [t(`${K.slice(0, 10)}${ch(cp)}${K.slice(10)}`)] } },
      { name: `a key ending with ${hex(cp)}`, body: { targets: [t(`${K}${ch(cp)}`)] } },
    ]),
    { name: 'a 1-unit key that is U+0000', body: { targets: [t(ch(0))] } },
    { name: 'a valid target beside a key holding U+2028', body: { targets: [t(K), t(`job${ch(0x2028)}1`)] } },
    { name: 'no state', body: { targets: [{ key: K }] } },
    { name: 'the state "ended"', body: { targets: [t(K, 'ended')] } },
    { name: 'the state "Waiting"', body: { targets: [t(K, 'Waiting')] } },
    { name: 'the state null', body: { targets: [t(K, null)] } },
    { name: 'the body an array', body: [t(K)] },
    { name: 'the body null', body: null },
  ];
  const good = [
    { name: 'one target', targets: [t(K)] },
    { name: 'fifty targets', targets: many(50) },
    { name: 'a 1-unit key', targets: [t('x')] },
    { name: 'a 256-unit key', targets: [t(long256)] },
    { name: '128 emoji (256 units)', targets: [t(EMOJI.repeat(128))] },
    { name: 'the id "manual run"', targets: [t('manual run')] },
    { name: 'the id "job/1"', targets: [t('job/1', 'running')] },
    { name: 'the key "__proto__"', targets: [t('__proto__')] },
    { name: 'the key "constructor"', targets: [t('constructor')] },
    ...[0x0020, 0x007E, 0x00A0, 0x2027, 0x202A, 0x200B, 0xFEFF, 0xD83D].map((cp) => ({ name: `a key holding ${hex(cp)}`, targets: [t(`${K.slice(0, 10)}${ch(cp)}${K.slice(10)}`)] })),
    ...['#', '%', '+', '"', '\\', 'é'].map((c) => ({ name: `a key holding ${show(c)} (refused by D9's old rule)`, targets: [t(`${K}${c}`)] })),
    { name: 'keys that differ only by case', targets: [t('Manual-Run'), t('manual-run')] },
    { name: 'keys that differ only by a trailing space', targets: [t('job-1'), t('job-1 ')] },
    { name: 'keys that differ only by normalisation (U+00E9 and e + U+0301)', targets: [t(ch(0xE9)), t(`e${ch(0x301)}`)] },
    { name: 'fifty distinct 256-unit keys', targets: Array.from({ length: 50 }, (_, i) => t(`${String(i).padStart(2, '0')}${long256.slice(2)}`)) },
    { name: 'the seed scheduled id', targets: [t(H.scheduledJobId(H.SEED_ENTRY_ID, T0 - MIN))] },
    { name: 'a legacy key', targets: [t(`${H.LEGACY_ID}@${T0 - HOUR}`, 'running')] },
    { name: 'a run: key', targets: [t(`run:${H.runIdAt(T0 - HOUR, '0a1b2c3d')}`, 'running')] },
  ];
  const s = scene();
  const p = [];
  const shorten = (v) => show(v).slice(0, 200);
  for (const c of bad) {
    const m = s.mark();
    const r = await s.stop('admin', null, { body: c.body });
    p.push(...statusProblems(c.name, r, 400));
    p.push(...untouchedProblems(c.name, s.since(m)));
  }
  // The 400's sentence names the rule a key must meet (Amendment 1 § A "The 400's sentence names the new rule"; its
  // wording is the Implementer's): it gives the 256 bound and no longer the 120 one.
  const r400 = await s.stop('admin', null, { body: { targets: [t(`${long256}x`)] } });
  const sentence = r400.body && typeof r400.body.error === 'string' ? r400.body.error : '';
  if (r400.status === 400 && (!/\b256\b/.test(sentence) || /\b120\b/.test(sentence))) {
    p.push(`the 400's error sentence should name the amended key rule (1 to 256 characters) and not D9's old 120 (${adr('Amendment 1 § A')}); it is ${show(sentence)}`);
  }
  for (const c of good) {
    const m = s.mark();
    const r = await s.stop('admin', c.targets);
    const d = s.since(m);
    if (r.status !== 409 || !r.body || r.body.code !== 'nothing-to-stop') p.push(`${c.name}: should pass validation and, with nothing busy, answer 409 nothing-to-stop (${adr('Amendment 1 § A')}; D9 step 2); it answered ${r.status} ${shorten(r.body)}`);
    if (!d.names.length) p.push(`${c.name}: the chain step never ran`);
    if (d.kills.length || d.writes) p.push(`${c.name}: nothing to stop changes nothing; kills ${show(d.kills)}, record writes ${d.writes}`);
  }
  report(p);
});

test('PX22: either may stop the other\'s waiting pass — an admin stops the pass the owner lined up, and the owner stops one an admin lined up: 200 { success: true, stopped: [{ key, how: "taken-out-of-line" }], recorded: true }, no signal is sent, the record keeps the start\'s who and adds the stop\'s who and skip, the history\'s newest line is the stop, and a Run afterwards lines up a new pass [AC-3 "Confirming a stop of a waiting pass"; AC-4 "Either may act on the other\'s pass"; AC-5; ADR tagging-edges/0006 D9 steps 4-5, D11]', async () => {
  await cases([
    { name: 'an admin stops the owner\'s', starter: 'owner', stopper: 'admin' },
    { name: 'the owner stops an admin\'s', starter: 'admin', stopper: 'owner' },
  ], async (c) => {
    const s = scene();
    const r1 = await s.run(c.starter);
    const K = r1.body && r1.body.key;
    assert(r1.status === 200 && typeof K === 'string', `the ${c.starter}'s Run should line up a pass; it answered ${showRes(r1)}`);
    s.world.clock.advance(MIN);
    const stopAt = iso(s.world.clock.now());
    const m = s.mark();
    const r = await s.stop(c.stopper, [{ key: K, state: 'waiting' }]);
    const d = s.since(m);
    const p = statusProblems('Stop', r, 200);
    p.push(...membersProblems('Stop', r.body, { success: true, stopped: [{ key: K, how: 'taken-out-of-line' }], recorded: true }));
    if (d.kills.length) p.push(`a waiting pass gets no signal; kills ${show(d.kills)}`);
    const e = entryOf(s.record_(), K);
    const p0 = [];
    if (!e) p0.push('no entry');
    else {
      if (!e.start || exact(e.start.who) !== exact(H.whoOf(c.starter))) p0.push(`start.who should be ${show(H.whoOf(c.starter))}`);
      if (!e.stop || exact(e.stop.who) !== exact(H.whoOf(c.stopper)) || e.stop.at !== stopAt || e.stop.runId !== null) p0.push(`stop should be { at: ${stopAt}, runId: null, who: ${show(H.whoOf(c.stopper))} }`);
      if (e.skip !== true) p0.push('skip should be true');
    }
    if (p0.length) p.push(`the record's entry for ${K}: ${p0.join('; ')} (${adr('D11')}); it is ${show(e)}`);
    const h0 = historyOf(s.record_())[0];
    if (exact(h0) !== exact({ action: 'stop', key: K, at: stopAt, who: H.whoOf(c.stopper) })) p.push(`the history's newest line should be the stop; the history is ${show(historyOf(s.record_()))}`);
    s.world.clock.advance(SEC);
    const again = await s.run(c.starter);
    p.push(...statusProblems('a Run after the stop (the stopped pass is no longer busy)', again, 200));
    report(p);
  });
});

test('PX23: an admin stops a running pass the owner started, one that has taken up the owner\'s confirmation — 200 { success: true, stopped: [{ key, how: "asked-to-stop" }], recorded: true }; exactly one SIGTERM goes to that pass\'s pid; the record keeps the owner\'s start and adds the admin\'s stop with the run\'s id, and noRerun [AC-3 "Confirming a stop of a running pass"; AC-4 "That includes a pass that is applying the owner\'s confirmation"; ADR tagging-edges/0006 D9 steps 3-5 ("process.kill(pid, SIGTERM)"), D11]', async () => {
  const s = scene({ confirmation: H.confirmationRecord() });
  const r1 = await s.run('owner');
  const K = r1.body && r1.body.key;
  assert(r1.status === 200 && typeof K === 'string', `the owner's Run should line up a pass; it answered ${showRes(r1)}`);
  s.world.clock.advance(SEC);
  const job = s.world.queue.pickUp();
  assert(job && job.id === K, 'the owner\'s job should be picked up');
  const run = s.world.startPass({ jobId: K, through: 'graph-read' });
  s.world.claim(run.runId, { save: true });
  s.world.clock.advance(MIN);
  const stopAt = iso(s.world.clock.now());
  const m = s.mark();
  const r = await s.stop('admin', [{ key: K, state: 'running' }]);
  const d = s.since(m);
  const p = statusProblems('Stop', r, 200);
  p.push(...membersProblems('Stop', r.body, { success: true, stopped: [{ key: K, how: 'asked-to-stop' }], recorded: true }));
  if (exact(d.kills) !== exact([{ pid: run.process.pid, signal: 'SIGTERM' }])) p.push(`exactly one SIGTERM should go to pid ${run.process.pid}; kills ${show(d.kills)}`);
  const e = entryOf(s.record_(), K);
  if (!e || !e.start || exact(e.start.who) !== exact(H.whoOf('owner'))) p.push(`the start's who should stay the owner's; the entry is ${show(e)}`);
  if (!e || !e.stop || exact(e.stop) !== exact({ at: stopAt, runId: run.runId, who: H.whoOf('admin') })) p.push(`the stop should be ${show({ at: stopAt, runId: run.runId, who: H.whoOf('admin') })} (${adr('D11')}); the entry is ${show(e)}`);
  if (!e || e.noRerun !== true) p.push(`noRerun should be true for a running target (${adr('D9')} step 4); the entry is ${show(e)}`);
  report(p);
});

test('PX24: Stop\'s refusals carry the fixed codes as written and change nothing — nothing busy: 409 { code: "nothing-to-stop" }; a prompt that said waiting for a pass that is running: 409 { code: "prompt-out-of-date", busy }; a prompt missing a busy pass: 409 prompt-out-of-date — no signal, no record write, and the passes stay busy [AC-3 "If what is busy has changed since the prompt opened … the stop is refused plainly and changes nothing", "Nothing to stop"; ADR tagging-edges/0006 D9 step 2, D14 "Fixed codes are sent as written"]', async () => {
  const RUNNING = H.lineUpKey(73);
  const WAITING = H.lineUpKey(74);
  await cases([
    { name: 'nothing busy', prep: () => {}, targets: [{ key: WAITING, state: 'waiting' }], code: 'nothing-to-stop' },
    { name: 'a prompt that said waiting for a running pass', prep: (s) => { s.world.startPass({ jobId: RUNNING }); }, targets: [{ key: RUNNING, state: 'waiting' }], code: 'prompt-out-of-date', busy: true },
    {
      name: 'a prompt missing a busy pass',
      prep: async (s) => { s.world.startPass({ jobId: RUNNING }); await s.world.queue.add(TASK, H.lineUpData(), H.lineUpOpts(WAITING)); },
      targets: [{ key: RUNNING, state: 'running' }],
      code: 'prompt-out-of-date',
      busy: true,
    },
  ], async (c) => {
    const s = scene();
    await c.prep(s);
    const m = s.mark();
    const r = await s.stop('admin', c.targets);
    const d = s.since(m);
    const p = statusProblems(c.name, r, 409);
    if (!r.body || r.body.code !== c.code || r.body.success === true) p.push(`the answer should carry code ${show(c.code)}; it is ${show(r.body)}`);
    if (c.busy && !(r.body && Array.isArray(r.body.busy))) p.push(`prompt-out-of-date carries busy (${adr('D9')}); the answer is ${show(r.body)}`);
    if (d.kills.length || d.writes) p.push(`nothing may change; kills ${show(d.kills)}, record writes ${d.writes}`);
    if (c.busy) {
      const again = await s.run('owner');
      if (again.status !== 409) p.push(`the passes should still be busy (a Run refused pass-busy); Run answered ${showRes(again)}`);
    }
    report(p);
  });
});

test('PX25: a Stop that cannot be recorded still takes effect — with the record\'s write failing (ENOSPC) after the owner\'s Run, an admin\'s Stop of that waiting pass, and with the record giving a read error (EIO) from the start, a Stop of a waiting pass lined up outside the app, each answer 200 { success: true, stopped: [{ key, how: "taken-out-of-line" }], recorded: false }; the record that gives a read error is unchanged byte for byte; and the pass is no longer busy (once the record is healed, a Run lines up a new one) [AC-5 "a Stop still takes effect, its answer says it was not recorded"; ADR tagging-edges/0006 D9 step 4 "A failed or refused write leaves the effect in place and sets recorded: false", D11 "While it still gives a read error, nothing writes it"; review-named case "A record that gives a read error is unchanged, byte for byte, after a Stop"]', async () => {
  const OUTSIDE = H.lineUpKey(60);
  const old = H.recordFile({ history: [H.historyLine('start', H.lineUpKey(41), iso(T0 - HOUR), H.whoOf('owner'))] });
  await cases([
    {
      name: 'the write fails',
      o: {},
      prep: async (s) => {
        const r1 = await s.run('owner');
        assert(r1.status === 200 && typeof r1.body.key === 'string', `the owner's Run should line up a pass; it answered ${showRes(r1)}`);
        s.world.record.failWrites('ENOSPC');
        return r1.body.key;
      },
    },
    {
      name: 'the record gives a read error',
      o: { record: { record: old, readError: 'EIO' } },
      prep: async (s) => { await s.world.queue.add(TASK, H.lineUpData(), H.lineUpOpts(OUTSIDE)); return OUTSIDE; },
      sameBytes: true,
    },
  ], async (c) => {
    const s = scene(c.o);
    const K = await c.prep(s);
    s.world.clock.advance(SEC);
    const bytes = s.world.record.bytes();
    const r = await s.stop('admin', [{ key: K, state: 'waiting' }]);
    const p = statusProblems('Stop', r, 200);
    p.push(...membersProblems('Stop', r.body, { success: true, stopped: [{ key: K, how: 'taken-out-of-line' }], recorded: false }));
    if (c.sameBytes && s.world.record.bytes() !== bytes) p.push(`the record that gives a read error changed: ${show(bytes)} → ${show(s.world.record.bytes())}`);
    s.world.record.heal();
    s.world.clock.advance(SEC);
    const again = await s.run('owner');
    if (again.status !== 200 || !again.body || again.body.key === K) p.push(`the stopped pass should no longer be busy, so a Run lines up a new one; Run answered ${showRes(again)}`);
    report(p);
  });
});

test('PX26: with every dependency throwing an odd code, each pass.js handler still resolves with an answer — Run and the run-task delegate 500 { code: "error", cause: "error" }; Stop 500 { code: "error" } or 503 QUEUE_UNAVAILABLE; the record read 500 { code: "error" } or 200 { state: "unreadable" } — and the odd code\'s text reaches no answer [ADR tagging-edges/0006 D6 "Every exported pass.js handler resolves and never rejects", D14 "Thrown codes go through allowErrorCode"]', async () => {
  const s = scene();
  const { createController } = controllerMod();
  const deps = withController(burningDeps(s.world), createController(burningDeps(s.world)));
  const odd = allowErrorCode(ODD_CODE);
  const p = [];
  const run = await s.run('owner', { deps });
  if (run.status !== 500 || !run.body || run.body.code !== 'error' || run.body.cause !== odd) p.push(`Run should answer 500 { code: "error", cause: ${show(odd)} }; it answered ${showRes(run)}`);
  const rt = await s.runTask('admin', { deps });
  if (rt.status !== 500 || !rt.body || rt.body.code !== 'error' || rt.body.cause !== odd) p.push(`run-task should answer 500 { code: "error", cause: ${show(odd)} }; it answered ${showRes(rt)}`);
  const st = await s.stop('admin', [{ key: H.lineUpKey(5), state: 'waiting' }], { deps });
  const stOk = (st.status === 500 && st.body && st.body.code === 'error' && (!has(st.body, 'cause') || st.body.cause === odd)) || (st.status === 503 && st.body && st.body.code === 'QUEUE_UNAVAILABLE');
  if (!stOk) p.push(`Stop should answer 500 { code: "error" } or 503 QUEUE_UNAVAILABLE; it answered ${showRes(st)}`);
  const g = await s.record('owner', { deps });
  const gOk = (g.status === 500 && g.body && g.body.code === 'error' && (!has(g.body, 'cause') || g.body.cause === odd)) || (g.status === 200 && g.body && g.body.state === 'unreadable' && (!has(g.body, 'readError') || g.body.readError === odd));
  if (!gOk) p.push(`the record read should answer 500 { code: "error" } or 200 { state: "unreadable" }; it answered ${showRes(g)}`);
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX27–PX29 — the record read (D13, D11)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX27: only a signed-in owner or admin from this site may read who — signed out 401, a session not authenticated 403, a stranger 403, the owner from another site 403 cross-site, an admin with Origin null 403 cross-site, a direct local call 401, each with ownerOrAdmin\'s sentence and without reading the record; the owner\'s and an admin\'s same-site reads in the same world do read it [AC-5 "Only a signed-in owner or admin may read who took an action, and the server enforces it"; ADR tagging-edges/0006 D13 "re-checked with ownerOrAdmin, sameHost included, as realtime/switch\'s GET is"]', async () => {
  const s = scene();
  const p = [];
  for (const c of PANEL_REFUSALS) {
    const m = s.mark();
    const r = await s.record(c.as, { origin: c.origin });
    p.push(...statusProblems(c.name, r, c.status));
    if (r.status === c.status && !refusedBody(r.body, c.error)) p.push(`${c.name}: the body should carry success false and error ${show(c.error)}; it is ${show(r.body)}`);
    p.push(...untouchedProblems(c.name, s.since(m)));
    if (r.body && (has(r.body, 'history') || has(r.body, 'passes'))) p.push(`${c.name}: a refusal carries no record; it is ${show(r.body)}`);
  }
  for (const as of ['owner', 'admin']) {
    const m = s.mark();
    const r = await s.record(as);
    const d = s.since(m);
    if (r.status !== 200 || !d.names.includes('readRecord')) p.push(`the paired ${as}'s read should answer 200 and read the record through readRecord; it answered ${showRes(r)} and called ${show(d.names)}`);
  }
  report(p);
});

test('PX28: the record read answers exactly { success: true, state, readError?, history, passes } — "empty" for a missing file (history [], passes {}); "recorded" with the record\'s history (newest first) and passes, to the owner and an admin alike; "unreadable" with readError "EIO" for a read error (history [], passes {}); "damaged" for text that does not parse (history [], passes {}, no readError) [AC-5 "With no action recorded, the panel says so and the history is empty"; ADR tagging-edges/0006 D13 "Answer. {success: true, state: recorded | empty | unreadable | damaged, readError?, history, passes}", D11 "Reading"]', async () => {
  const KA = H.lineUpKey(1);
  const KB = H.lineUpKey(2);
  const rec = H.recordFile({
    passes: {
      [KA]: H.recordEntry({ jobId: KA, start: { at: iso(T0 - 3 * HOUR), who: H.whoOf('owner') }, stop: { at: iso(T0 - 2 * HOUR), runId: null, who: H.whoOf('admin') }, skip: true }),
      [KB]: H.recordEntry({ jobId: KB, start: { at: iso(T0 - HOUR), who: H.whoOf('local') } }),
    },
    history: [
      H.historyLine('start', KB, iso(T0 - HOUR), H.whoOf('local')),
      H.historyLine('stop', KA, iso(T0 - 2 * HOUR), H.whoOf('admin')),
      H.historyLine('start', KA, iso(T0 - 3 * HOUR), H.whoOf('owner')),
    ],
  });
  await cases([
    { name: 'a missing file', o: {}, want: { success: true, state: 'empty', history: [], passes: {} } },
    { name: 'a record, read by the owner', o: { record: { record: rec } }, want: { success: true, state: 'recorded', history: rec.history, passes: rec.passes } },
    { name: 'a record, read by an admin', as: 'admin', o: { record: { record: rec } }, want: { success: true, state: 'recorded', history: rec.history, passes: rec.passes } },
    { name: 'a read error', o: { record: { record: rec, readError: 'EIO' } }, want: { success: true, state: 'unreadable', readError: allowErrorCode('EIO'), history: [], passes: {} } },
    { name: 'text that does not parse', o: { record: { text: '{"version":1,"passes":' } }, want: { success: true, state: 'damaged', history: [], passes: {} } },
  ], async (c) => {
    const s = scene(c.o);
    const r = await s.record(c.as || 'owner');
    const p = statusProblems(c.name, r, 200);
    if (exact(r.body) !== exact(c.want)) p.push(`${c.name}: the answer should be ${show(c.want)}; it is ${show(r.body)}`);
    report(p);
  });
});

test('PX29: after the owner\'s Run, an admin\'s Stop of it and a local call\'s run-task start, the record read names each action\'s who by kind and shortened key only — start { kind: "owner", key }, stop { kind: "admin", key }, start { kind: "local" } — with the history newest first, and no answer along the way carries a full pubkey [AC-5 "Every action records who took it and when", "the last 10 actions, newest first"; ADR tagging-edges/0006 D11 shape ("key": "<8 hex, owner or admin only>"), D13, D14 "No answer carries a full pubkey"]', async () => {
  const s = scene();
  const p = [];
  const r1 = await s.run('owner');
  const K1 = r1.body && r1.body.key;
  const t1 = iso(s.world.clock.now());
  s.world.clock.advance(MIN);
  const t2 = iso(s.world.clock.now());
  const r2 = await s.stop('admin', [{ key: K1, state: 'waiting' }]);
  s.world.clock.advance(MIN);
  const t3 = iso(s.world.clock.now());
  const r3 = await s.runTask('local');
  const K2 = r3.body && r3.body.jobId;
  if (r1.status !== 200 || r2.status !== 200 || r3.status !== 200) p.push(`the three actions should each answer 200; they answered ${showRes(r1)}, ${showRes(r2)}, ${showRes(r3)}`);
  const g = await s.record('admin');
  const want = [
    { action: 'start', key: K2, at: t3, who: { kind: 'local' } },
    { action: 'stop', key: K1, at: t2, who: H.whoOf('admin') },
    { action: 'start', key: K1, at: t1, who: H.whoOf('owner') },
  ];
  if (!g.body || exact(g.body.history) !== exact(want)) p.push(`the history should be ${show(want)}; the answer is ${show(g.body)}`);
  const e1 = g.body && g.body.passes && g.body.passes[K1];
  if (!e1 || !e1.start || !e1.stop || exact(e1.start.who) !== exact(H.whoOf('owner')) || exact(e1.stop.who) !== exact(H.whoOf('admin'))) p.push(`passes[${K1}] should carry the owner's start and the admin's stop; it is ${show(e1)}`);
  const e2 = g.body && g.body.passes && g.body.passes[K2];
  if (!e2 || !e2.start || exact(e2.start.who) !== exact({ kind: 'local' })) p.push(`passes[${K2}] should carry the local call's start; it is ${show(e2)}`);
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX30 — D14 across every answer
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX30: D14\'s convention holds across every pass.js answer — 401 and 403 are refusals with success false; 409 carries pass-busy, prompt-out-of-date, nothing-to-stop or pass-not-reachable; 503 carries QUEUE_UNAVAILABLE; 500 carries record-unavailable or error; every fixed code is sent as written, any cause is allow-listed (allowErrorCode(cause) === cause), a 2xx says success true, and no answer carries a full pubkey [ADR tagging-edges/0006 D14 "Answers and codes", "Story 5\'s convention holds"]', async () => {
  const answers = [];
  const add = (label, r) => answers.push({ label, r });
  {
    const s = scene();
    add('Run, signed out', await s.run('signed-out'));
    add('Run, a stranger', await s.run('stranger'));
    add('Run, another site', await s.run('owner', { origin: 'other' }));
    add('Run, text/plain', await s.run('owner', { contentType: 'text/plain' }));
    add('Run, a bad body', await s.run('owner', { body: { a: 1 } }));
    add('Stop, nothing busy', await s.stop('admin', [{ key: H.lineUpKey(3), state: 'waiting' }]));
    add('Run', await s.run('owner'));
    s.world.clock.advance(SEC);
    add('Run, busy', await s.run('admin'));
    add('run-task, busy', await s.runTask('admin'));
    add('the record read', await s.record('owner'));
  }
  {
    const s = scene();
    s.world.enabled = false;
    add('Run, the flag off', await s.run('owner'));
    add('run-task, the flag off', await s.runTask('local'));
  }
  {
    const s = scene();
    s.world.record.failWrites('ENOSPC');
    add('Run, the record write fails', await s.run('owner'));
    add('run-task, the record write fails', await s.runTask('owner'));
  }
  {
    const s = scene();
    s.world.startPass({ jobId: H.lineUpKey(75) });
    add('Stop, a stale prompt', await s.stop('owner', [{ key: H.lineUpKey(75), state: 'waiting' }]));
    add('Stop', await s.stop('owner', [{ key: H.lineUpKey(75), state: 'running' }]));
  }
  const p = [];
  for (const { label, r } of answers) {
    const b = r.body || {};
    if (r.status >= 200 && r.status < 300) { if (b.success !== true) p.push(`${label}: a ${r.status} should say success true; it is ${show(b)}`); continue; }
    if (b.success === true) p.push(`${label}: a ${r.status} says success true`);
    if (r.status === 401 || r.status === 403) { if (typeof b.error !== 'string') p.push(`${label}: a ${r.status} refusal should carry an error sentence; it is ${show(b)}`); }
    else if (r.status === 409) { if (!['pass-busy', 'prompt-out-of-date', 'nothing-to-stop', 'pass-not-reachable'].includes(b.code)) p.push(`${label}: a 409 should carry one of D14's refusal codes; it is ${show(b)}`); }
    else if (r.status === 503) { if (b.code !== 'QUEUE_UNAVAILABLE') p.push(`${label}: a 503 should carry QUEUE_UNAVAILABLE; it is ${show(b)}`); }
    else if (r.status === 500) { if (b.code !== 'record-unavailable' && b.code !== 'error') p.push(`${label}: a 500 should carry record-unavailable or error; it is ${show(b)}`); }
    else if (r.status !== 400 && r.status !== 415) p.push(`${label}: an unexpected status ${r.status} ${show(b)}`);
    if (has(b, 'code') && r.status >= 409 && !FIXED_CODES.includes(b.code) && b.code !== 'error') p.push(`${label}: code ${show(b.code)} is not one of D14's fixed codes`);
    if (has(b, 'cause') && b.cause !== allowErrorCode(b.cause)) p.push(`${label}: cause ${show(b.cause)} is not allow-listed`);
  }
  const seen = new Set(answers.map(({ r }) => r.status));
  for (const st of [200, 401, 403, 409, 415, 400, 500, 503]) if (!seen.has(st)) p.push(`no answer in this sweep had status ${st}, so the sweep did not cover it (statuses: ${show([...seen].sort())})`);
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX31–PX32 — defaultDeps includes getAdminPubkeys (the SWR74 trap)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Source with comments dropped (strings kept), as the wiring suite's jsCodeOnly. */
function jsCodeOnly(src) {
  let out = '';
  let i = 0;
  let q = null;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n || ''; i += 2; continue; }
      if (c === q) q = null;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; out += ' '; continue; }
    if (c === '/' && n === '/') { const end = src.indexOf('\n', i); i = end < 0 ? src.length : end; continue; }
    if (c === '\'' || c === '"' || c === '`') q = c;
    out += c;
    i += 1;
  }
  return out;
}
/** From the first `{` at or after `from`, the text up to its matching `}` (quotes skipped). */
function braceBlock(code, from) {
  const start = code.indexOf('{', from);
  if (start < 0) return null;
  let depth = 0;
  let q = null;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === '\\') i++; else if (c === q) q = null; continue; }
    if (c === '\'' || c === '"' || c === '`') q = c;
    else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return code.slice(start, i + 1); }
  }
  return null;
}

test('PX31: pass.js\'s defaultDeps names a getAdminPubkeys member — every suite that admits an admin injects the lookup, so without this default every admin would be refused in production while the suites stay green. ADR 0006 names no form for the member, so this static check (comments dropped) asks only that defaultDeps\' body define one (getAdminPubkeys: …, a getAdminPubkeys() method, the shorthand getAdminPubkeys, or an assignment to .getAdminPubkeys); PX32 checks in a child process that it answers the configured admin [ADR tagging-edges/0006 Implementation notes: "Its one defaultDeps serves every handler in it, and must include getAdminPubkeys (the SWR74 trap)"]', () => {
  const file = path.join(REPO, MODULES.pass);
  assert(fs.existsSync(file), `${MODULES.pass} does not exist yet (${adr('Implementation notes, "The routes"')})`);
  const code = jsCodeOnly(fs.readFileSync(file, 'utf8'));
  const def = /\b(?:async\s+)?function\s+defaultDeps\s*\(|\b(?:const|let|var)\s+defaultDeps\s*=/.exec(code);
  assert(def, `${MODULES.pass} defines no defaultDeps — the handlers' real dependencies (${adr('Implementation notes')})`);
  const body = braceBlock(code, def.index + def[0].length);
  assert(body, `${MODULES.pass}'s defaultDeps has no body this pin can read`);
  const member = /[{,]\s*(?:async\s+)?(?:getAdminPubkeys|(['"])getAdminPubkeys\1)\s*(?::|\(|,|\})|\.\s*getAdminPubkeys\s*=(?!=)|\[\s*(['"])getAdminPubkeys\2\s*\]\s*=(?!=)/;
  assert(member.test(body), `${MODULES.pass}'s defaultDeps names no getAdminPubkeys member — the admin list ownerOrAdmin consults for a real request; without it an admin lookup throws, which admits no admin (${adr('Implementation notes')}: "must include getAdminPubkeys")`);
});

// ─── the child process: the real middleware, the real handleRunTask, and pass.js's real defaults ───────────────

/**
 * Runs in a child (`node -e`), self-contained. Reads its spec from PX_SPEC; prints one @@PX-CHILD@@ line with the
 * results. Nothing is ever launched (every child_process entry point records and refuses), and the task queue module
 * is a recording stub in require's cache, so the old run-task path can reach neither Redis nor a task. Before any
 * module loads, structuredEvents is the helper's recording stand-in (it writes nothing), the console is captured
 * rather than printed, and process.kill refuses every call. Phases, in order: PX38's actions and reads (before
 * the delegate is wrapped, with deps passed explicitly), the real-middleware requests (PX33–PX37), pass.js's real
 * defaults (PX32).
 */
function pxChild() {
  const fs0 = require('fs');
  const path0 = require('path');
  const http0 = require('http');
  const Module0 = require('module');
  const cp0 = require('child_process');
  const { EventEmitter } = require('events');
  const spec = JSON.parse(process.env.PX_SPEC);
  const ROOT = spec.repo;
  // The helper requires only Node built-ins at load, so loading it first loads nothing under test.
  const H0 = require(spec.helper);
  const rec = H0.recordStructuredEvents();
  const cap = H0.captureConsole();
  const guard = H0.guardProcessKill({ label: 'the PX child' });
  const out = { results: [], defaults: null, who: null, loaded: {}, spawns: [], execSync: 0, directKills: guard.directKills, error: null };
  const first = (e) => String((e && e.message) || e).split('\n')[0];
  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    const line = `\n@@PX-CHILD@@${JSON.stringify(out)}\n`;
    try { process.stdout.write(line, () => process.exit(code)); } catch (_) { process.exit(code); }
  };
  setTimeout(() => { out.error = `the child did not finish within ${spec.timeoutMs} ms`; finish(1); }, spec.timeoutMs).unref();
  const PREFIX = '/usr/local/lib/node_modules/brainstorm/';
  const origResolve = Module0._resolveFilename;
  Module0._resolveFilename = function resolveForTest(request, ...rest) {
    if (typeof request === 'string' && request.startsWith(PREFIX)) request = path0.join(ROOT, request.slice(PREFIX.length));
    return origResolve.call(this, request, ...rest);
  };
  let currentId = null;
  const blocked = () => Object.assign(new Error('blocked by tagging-edges-pass-routes: nothing is launched'), { code: 'EPERM' });
  const fakeChild = () => {
    const c = new EventEmitter();
    c.stdout = new EventEmitter();
    c.stderr = new EventEmitter();
    c.stdin = { write() { return true; }, end() {} };
    c.kill = () => true;
    c.unref = () => {};
    process.nextTick(() => c.emit('error', blocked()));
    return c;
  };
  const describe = (name, a) => `${name} ${String(a[0]).slice(0, 160)}${Array.isArray(a[1]) ? ` ${a[1].map(String).join(' ').slice(0, 240)}` : ''}`;
  for (const name of ['spawn', 'exec', 'execFile', 'fork']) {
    cp0[name] = function recordLaunch(...a) {
      out.spawns.push({ at: currentId, call: describe(name, a) });
      const cb = a.find((x) => typeof x === 'function');
      if (cb) process.nextTick(() => cb(blocked(), '', ''));
      return fakeChild();
    };
  }
  for (const name of ['spawnSync', 'execFileSync']) {
    cp0[name] = function recordLaunchSync(...a) { out.spawns.push({ at: currentId, call: describe(name, a) }); throw blocked(); };
  }
  // getConfigFromFile's `source` fallback only; it runs nothing here.
  cp0.execSync = function noShell() { out.execSync += 1; return Buffer.from(''); };

  /**
   * PX38. In one world, with deps passed explicitly: an admin's Run, which the owner stops while it runs; the owner's
   * Run, which an admin takes out of line; a direct local call's start, which the owner takes out of line. Between
   * them, signed-out reads of the public status; at the end, of the status, the held list and the Task Explorer's data
   * for this task (over an events.jsonl holding every line this process has logged, plus one of the test's own); then
   * the owner's gated record read, the positive control. → what each answered, and everything logged, launched or
   * signalled meanwhile.
   */
  async function whoPhase(pass, ctlMod) {
    const w = { error: null, keys: {}, runId: null, steps: [], events: [], lines: [], console: [], spawns: [], directKills: [], logFile: null };
    const marks = { e: rec.events.length, l: rec.lines.length, c: cap.lines.length, s: out.spawns.length, k: guard.directKills.length };
    const j = (v) => { try { return JSON.stringify(v); } catch (_) { return String(v); } };
    currentId = 'PX38';
    let world = null;
    try {
      if (!pass) throw new Error(`${spec.passRel} did not load in the child: ${out.loaded.passError}`);
      if (!ctlMod || typeof ctlMod.createController !== 'function') throw new Error(`${spec.controllerRel} did not load in the child: ${out.loaded.controllerError || `it exports ${j(Object.keys(ctlMod || {}))}`}`);
      const routes = require(path0.join(ROOT, spec.who.routesRel));
      const explorer = require(path0.join(ROOT, spec.who.explorerRel));
      const se = require(rec.file);
      const P = H0.PATHS;
      world = H0.makeWorld();
      const ctl = ctlMod.createController(world.deps);
      const deps = Object.assign({}, world.deps, { controller: ctl, lineUp: (...a) => ctl.lineUp(...a), stop: (...a) => ctl.stop(...a), snapshot: (...a) => ctl.snapshot(...a) });
      const enoent = (p) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' });
      // index.js's reads of report.json and confirmation.json, from the world (the CT suite's statusReadFile).
      const readFile = async (p) => {
        const f = String(p);
        if (f.endsWith(`${path0.sep}report.json`)) { if (world.report == null) throw enoent(f); return JSON.stringify(world.report); }
        if (f.endsWith(`${path0.sep}confirmation.json`)) { if (world.confirmation == null) throw enoent(f); return JSON.stringify(world.confirmation); }
        throw enoent(f);
      };
      const readDeps = Object.assign({}, deps, { readFile });
      const step = async (kind, label, fn, req, d) => {
        const r = await H0.callHandler(fn, req, d, { timeoutMs: 6000 });
        const s = { kind, label, status: r.status, body: r.body, rejected: r.rejected ? first(r.rejected) : null };
        w.steps.push(s);
        return s;
      };
      const need = (s, ok, what) => {
        if (!ok) throw new Error(`setup: ${s.label} should ${what}; it answered ${s.status} ${j(s.body)}${s.rejected ? ` (it rejected: ${s.rejected})` : ''}`);
        return s;
      };
      const gateStep = async (name, job) => {
        try { return await ctl.gate[name](job); } catch (e) { throw new Error(`setup: gate.${name}(${job && job.id}) threw: ${first(e)}`); }
      };
      const run = (as) => step('action', `the ${as}'s Run`, pass.handlePassRun, H0.passReq(as, { path: P.run, origin: 'same' }), deps);
      const linedUp = (s) => need(s, s.status === 200 && !!s.body && s.body.success === true && typeof s.body.key === 'string', 'answer 200 { success: true, linedUp: true, key }');
      const stop = async (as, key, state, whose, how) => {
        const s = await step('action', `the ${as}'s Stop of ${whose}`, pass.handlePassStop, H0.passReq(as, { path: P.stop, origin: 'same', body: { targets: [{ key, state }] } }), deps);
        return need(s, s.status === 200 && !!s.body && s.body.success === true && j(s.body.stopped) === j([{ key, how }]), `answer 200 { success: true, stopped: [{ key: ${j(key)}, how: ${j(how)} }] }`);
      };
      const status = (when) => step('read', `the public status, signed out, ${when}`, routes.handleStatus, H0.passReq('signed-out', { method: 'GET', path: P.status }), readDeps);

      // An admin's Run waits, is picked up and runs; the owner stops it while it runs; it ends, stopped.
      const K1 = linedUp(await run('admin')).body.key;
      w.keys.K1 = K1;
      world.clock.advance(1000);
      await status('while the admin\'s pass waits');
      const job = world.queue.pickUp();
      if (!job || job.id !== K1) throw new Error(`setup: the admin's job ${K1} should be picked up; the queue gave ${j(job && job.id)}`);
      const g1 = await gateStep('beforeAcquire', job);
      const g2 = await gateStep('afterAcquire', job);
      if (g1 !== 'go' || g2 !== 'go') throw new Error(`setup: the gate should let the admin's job run; beforeAcquire and afterAcquire answered ${j([g1, g2])}`);
      world.clock.advance(1000);
      w.runId = world.startPass({ jobId: K1 }).runId;
      world.clock.advance(60000);
      await stop('owner', K1, 'running', 'the admin\'s running pass', 'asked-to-stop');
      await status('while the owner\'s stop of the admin\'s running pass is asked');
      world.clock.advance(2000);
      world.endPass({ state: 'stopped' });
      world.queue.complete(K1);
      await gateStep('ended', job);
      world.clock.advance(1000);
      // The owner's Run waits; an admin takes it out of line.
      const K2 = linedUp(await run('owner')).body.key;
      w.keys.K2 = K2;
      world.clock.advance(60000);
      await stop('admin', K2, 'waiting', 'the owner\'s waiting pass', 'taken-out-of-line');
      // A direct local call's start waits; the owner takes it out of line.
      world.clock.advance(1000);
      const lc = await step('action', 'a direct local call\'s run-task', pass.handleRunTaskForPass, H0.passReq('local', { path: P.runTask, query: { taskName: H0.TASK }, contentType: null, body: undefined }), deps);
      need(lc, lc.status === 200 && !!lc.body && lc.body.success === true && typeof lc.body.jobId === 'string', 'answer 200 { success: true, queued: true, jobId }');
      const K3 = lc.body.jobId;
      w.keys.K3 = K3;
      world.clock.advance(1000);
      await status('while the local call\'s pass waits');
      world.clock.advance(60000);
      await stop('owner', K3, 'waiting', 'the local call\'s waiting pass', 'taken-out-of-line');

      // What the Task Explorer reads: every line this process has logged so far, and one line of the test's own.
      se.emitTaskEvent('PROGRESS', H0.TASK, '', { phase: 'px38-sentinel', step: 'a line the test logged itself' });
      process.env.BRAINSTORM_LOG_DIR = spec.who.logDir;
      w.logFile = rec.writeJsonl(spec.who.logDir);
      world.clock.advance(1000);
      await status('at the end');
      await step('read', 'the held list, signed out, at the end', routes.handleHeld, H0.passReq('signed-out', { method: 'GET', path: '/api/tagging-edges/held' }), readDeps);
      await step('read', 'the Task Explorer\'s data for this task, signed out, at the end', explorer, H0.passReq('signed-out', { method: 'GET', path: '/api/task-explorer/single-task/data', query: { taskName: H0.TASK } }), undefined);
      // The positive control: the owner's gated read of the record names each who.
      await step('gated', 'the owner\'s gated record read', pass.handlePassRecord, H0.passReq('owner', { method: 'GET', path: P.record, origin: 'same' }), deps);
    } catch (e) {
      w.error = first(e);
    } finally {
      w.events = rec.events.slice(marks.e);
      w.lines = rec.lines.slice(marks.l);
      w.console = cap.lines.slice(marks.c);
      w.spawns = out.spawns.slice(marks.s);
      w.directKills = guard.directKills.slice(marks.k);
      if (world) world.cleanup();
      currentId = null;
    }
    return w;
  }

  const qPath = require.resolve(path0.join(ROOT, 'src/manage/taskQueue/queue/index.js'));
  const qcalls = [];
  const qAnswers = {
    isQueueAvailable: async () => true,
    queueHealth: () => 'ready',
    runViaQueueAsync: async (a) => ({ success: true, executionMode: 'async', jobId: (a && a.taskName) || 'stub', statusMessage: 'enqueued by the old path (test stub)' }),
    runViaQueueSync: async (a) => ({ success: true, executionMode: 'sync', jobId: (a && a.taskName) || 'stub', statusMessage: 'ran by the old path (test stub)' }),
  };
  const qStub = new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string' || name === 'then' || name === '__esModule' || name === 'default') return undefined;
      return function stubbedQueue(...a) {
        qcalls.push({ at: currentId, name, taskName: a[0] && typeof a[0] === 'object' ? a[0].taskName : (typeof a[0] === 'string' ? a[0] : undefined) });
        return qAnswers[name] ? qAnswers[name](...a) : undefined;
      };
    },
  });
  const qm = new Module0(qPath);
  qm.filename = qPath;
  qm.loaded = true;
  qm.exports = qStub;
  require.cache[qPath] = qm;

  (async () => {
    const bc = require(path0.join(ROOT, 'src/utils/brainstormConfig'));
    const express = require(path0.join(ROOT, 'node_modules/express'));
    const { authMiddleware } = require(path0.join(ROOT, 'src/middleware/auth.js'));
    const { handleRunTask } = require(path0.join(ROOT, 'src/api/manage/commands/runTask.js'));
    let pass = null;
    let ctlMod = null;
    try { pass = require(path0.join(ROOT, spec.passRel)); out.loaded.pass = Object.keys(pass); } catch (e) { out.loaded.passError = first(e); }
    try { ctlMod = require(path0.join(ROOT, spec.controllerRel)); out.loaded.controller = Object.keys(ctlMod); } catch (e) { out.loaded.controllerError = first(e); }
    out.who = await whoPhase(pass, ctlMod);
    let current = null;
    let delegateCalls = 0;
    if (pass && typeof pass.handleRunTaskForPass === 'function') {
      const orig = pass.handleRunTaskForPass;
      const wrapped = function wrappedForTest(req, res) {
        delegateCalls += 1;
        return orig.call(this, req, res, current && current.deps ? current.deps : undefined);
      };
      try { pass.handleRunTaskForPass = wrapped; } catch (e) { out.loaded.wrapError = first(e); }
      out.loaded.wrapped = pass.handleRunTaskForPass === wrapped;
    }
    function makeCase(setup) {
      const world = H0.makeWorld({ enabled: setup.flag !== false });
      if (setup.busy === 'running') world.startPass({ jobId: H0.lineUpKey(90) });
      let deps;
      if (ctlMod && typeof ctlMod.createController === 'function') {
        const ctl = ctlMod.createController(world.deps);
        deps = Object.assign({}, world.deps, { controller: ctl, lineUp: (...a) => ctl.lineUp(...a), stop: (...a) => ctl.stop(...a), snapshot: (...a) => ctl.snapshot(...a) });
      }
      return { world, deps };
    }

    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { const s = req.headers['x-test-session']; req.session = s ? JSON.parse(s) : {}; next(); });
    app.use(authMiddleware);
    app.post('/api/run-task', handleRunTask);
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = server.address().port;
    const send = (q) => new Promise((resolve) => {
      const caller = spec.callers[q.caller];
      const headers = {};
      if (caller.proxied) headers['X-Forwarded-For'] = '203.0.113.9';
      if (caller.session) headers['X-Test-Session'] = JSON.stringify(caller.session);
      if (q.origin === 'same') headers.Origin = `http://127.0.0.1:${port}`;
      else if (q.origin) headers.Origin = q.origin;
      const r = http0.request({ host: '127.0.0.1', port, path: q.url, method: 'POST', headers, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => { let parsed = body; try { parsed = JSON.parse(body); } catch (_) { /* text */ } resolve({ status: res.statusCode, body: parsed }); });
      });
      r.setTimeout(8000, () => r.destroy(new Error('no answer within 8000 ms')));
      r.on('error', (e) => resolve({ status: -1, body: first(e) }));
      r.end();
    });

    for (const q of spec.requests) {
      currentId = q.id;
      const setup = q.setup || {};
      bc.variables.TASK_QUEUE_ENABLED = setup.flag === false ? 'false' : 'true';
      let c;
      try { c = makeCase(setup); } catch (e) { out.results.push({ id: q.id, error: `setup: ${first(e)}` }); continue; }
      current = c;
      const d0 = delegateCalls;
      const q0 = qcalls.length;
      const s0 = out.spawns.length;
      const k0 = guard.directKills.length;
      const r = await send(q);
      await new Promise((res) => { setTimeout(res, 30); });
      const w = c.world;
      out.results.push({
        id: q.id,
        status: r.status,
        body: r.body,
        delegateCalls: delegateCalls - d0,
        oldPath: qcalls.slice(q0),
        spawns: out.spawns.slice(s0),
        directKills: guard.directKills.slice(k0),
        adds: w.queue.calls.filter((x) => x.method === 'add').map((x) => x.args[2] && x.args[2].jobId),
        worldCalls: w.names(),
        recordWrites: w.record.writes.length,
        record: w.record.parsed(),
      });
      current = null;
      w.cleanup();
    }
    currentId = null;
    await new Promise((resolve) => { server.close(resolve); });

    // pass.js's real defaults: the admin list, and the record read with no deps injected (and with Express's next).
    if (pass) {
      const d0 = pass.defaultDeps;
      out.defaults = { type: typeof d0, gets: {} };
      let dd = null;
      try { dd = typeof d0 === 'function' ? d0() : d0; } catch (e) { out.defaults.callError = first(e); }
      out.defaults.hasGetAdminPubkeys = !!dd && typeof dd.getAdminPubkeys === 'function';
      if (out.defaults.hasGetAdminPubkeys) { try { out.defaults.admins = dd.getAdminPubkeys(); } catch (e) { out.defaults.adminsError = first(e); } }
      if (typeof pass.handlePassRecord === 'function') {
        for (const [label, as, third] of [['admin', 'admin', undefined], ['owner', 'owner', undefined], ['stranger', 'stranger', undefined], ['admin, with next', 'admin', 'next']]) {
          let nextCalls = 0;
          const next = () => { nextCalls += 1; };
          try {
            const req = H0.passReq(as, { method: 'GET', path: H0.PATHS.record, origin: 'same' });
            const r = await H0.callHandler(pass.handlePassRecord, req, third === 'next' ? next : undefined, { timeoutMs: 5000 });
            out.defaults.gets[label] = { status: r.status, body: r.body, rejected: r.rejected ? first(r.rejected) : null, nextCalls };
          } catch (e) { out.defaults.gets[label] = { error: first(e), nextCalls }; }
        }
      }
    }
    finish(0);
  })().catch((e) => { out.error = String((e && e.stack) || e); finish(1); });
}

const SAME = 'same';
const OTHER_ORIGIN = H.ORIGINS.other;
/** The Task Explorer's single-task data handler (GET /api/task-explorer/single-task/data), a public view of a run. */
const TASK_EXPLORER_REL = 'src/api/taskExplorer/getTaskExplorerSingleTaskData.js';
const RT = (q) => `${PATHS.runTask}?${q}`;
const THIS = `taskName=${TASK}`;
const MW_REQUESTS = [
  { id: 'signed-out', caller: 'signedOut', url: RT(THIS), origin: SAME },
  { id: 'stranger', caller: 'stranger', url: RT(THIS), origin: SAME },
  { id: 'owner', caller: 'owner', url: RT(THIS), origin: SAME },
  { id: 'admin', caller: 'admin', url: RT(THIS), origin: SAME },
  { id: 'owner-other-site', caller: 'owner', url: RT(THIS), origin: OTHER_ORIGIN },
  { id: 'local', caller: 'local', url: RT(THIS) },
  { id: 'local-other-site', caller: 'local', url: RT(THIS), origin: OTHER_ORIGIN },
  { id: 'owner-busy', caller: 'owner', url: RT(THIS), origin: SAME, setup: { busy: 'running' } },
  { id: 'owner-flag-off', caller: 'owner', url: RT(THIS), origin: SAME, setup: { flag: false } },
  { id: 'owner-bracketed', caller: 'owner', url: RT(`taskName%5B%5D=${TASK}`), origin: SAME },
  { id: 'owner-indexed', caller: 'owner', url: RT(`taskName%5B0%5D=${TASK}`), origin: SAME },
  { id: 'owner-repeated', caller: 'owner', url: RT(`${THIS}&${THIS}`), origin: SAME },
  { id: 'owner-keyed', caller: 'owner', url: RT(`taskName%5Ba%5D=${TASK}`), origin: SAME },
  { id: 'other-owner-other-site', caller: 'owner', url: RT(`taskName=${OTHER_TASK}`), origin: OTHER_ORIGIN },
  { id: 'other-signed-out', caller: 'signedOut', url: RT(`taskName=${OTHER_TASK}`), origin: SAME },
  { id: 'other-stranger', caller: 'stranger', url: RT(`taskName=${OTHER_TASK}`), origin: SAME },
];

let MW = null;
/** One child run for every real-middleware case (memoized): the conf seam names the owner, the settings file the admin. */
function middlewareRun() {
  if (MW) return MW;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tagging-edges-pass-routes-mw-'));
  try {
    const conf = path.join(dir, 'brainstorm.conf');
    const settings = path.join(dir, 'settings.json');
    const stateDir = path.join(dir, 'state');
    const logDir = path.join(dir, 'logs');
    fs.mkdirSync(stateDir);
    fs.mkdirSync(logDir);
    fs.writeFileSync(conf, `export BRAINSTORM_OWNER_PUBKEY="${OWNER}"\n`);
    fs.writeFileSync(settings, JSON.stringify({ adminPubkeys: [ADMIN] }));
    const spec = {
      repo: REPO,
      helper: path.join(__dirname, 'helpers', 'taggingEdgesPassFakes.js'),
      passRel: MODULES.pass,
      controllerRel: MODULES.controller,
      who: { logDir, routesRel: MODULES.routes, explorerRel: TASK_EXPLORER_REL },
      timeoutMs: 60000,
      callers: {
        signedOut: { session: null, proxied: true },
        stranger: { session: { authenticated: true, pubkey: STRANGER }, proxied: true },
        owner: { session: { authenticated: true, pubkey: OWNER }, proxied: true },
        admin: { session: { authenticated: true, pubkey: ADMIN }, proxied: true },
        local: { session: null, proxied: false },
      },
      requests: MW_REQUESTS,
    };
    const env = {
      ...process.env,
      BRAINSTORM_CONF_PATH: conf,
      TAPESTRY_SETTINGS_PATH: settings,
      TAGGING_EDGES_STATE_DIR: stateDir,
      BRAINSTORM_STRUCTURED_LOGGING: 'false',
      BRAINSTORM_LOG_DIR: logDir,
      BRAINSTORM_MODULE_BASE_DIR: `${REPO}/`,
      PX_SPEC: JSON.stringify(spec),
    };
    const r = spawnSync(process.execPath, ['-e', `(${pxChild.toString()})();`], { cwd: REPO, env, encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
    const line = String(r.stdout || '').split('\n').find((l) => l.startsWith('@@PX-CHILD@@'));
    let data = null;
    let error = null;
    if (!line) error = `the child printed no result; exit ${r.status}, signal ${r.signal}, error ${r.error ? firstLine(r.error) : 'none'}, stderr: ${String(r.stderr || '').slice(-800)}`;
    else {
      try { data = JSON.parse(line.slice('@@PX-CHILD@@'.length)); } catch (e) { error = `the child's result did not parse: ${firstLine(e)}`; }
    }
    if (data && data.error) error = `the child failed: ${String(data.error).split('\n').slice(0, 3).join(' | ')}`;
    const byId = new Map();
    if (data) for (const x of data.results) byId.set(x.id, x);
    MW = { data, error, byId };
    return MW;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
function mwGet(id) {
  const run = middlewareRun();
  assert(!run.error || run.byId.has(id), `the real-middleware child failed: ${run.error}`);
  const x = run.byId.get(id);
  assert(x, `no real-middleware result for ${id}${run.error ? ` (${run.error})` : ''}`);
  assert(!x.error, `${id}: ${x.error}`);
  assert(!(x.directKills && x.directKills.length), `${id}: the code under test called process.kill directly in the child (${show(x.directKills)}); a signal goes only through the injected kill(pid, signal) dep (${adr('D9')}; § Seams deps list)`);
  return x;
}
/** Why the delegate could not be reached, from what the child loaded (for red-phase messages). */
function mwWhy() {
  const l = (middlewareRun().data || {}).loaded || {};
  if (l.passError) return ` (${MODULES.pass} did not load in the child: ${l.passError})`;
  if (l.controllerError) return ` (${MODULES.controller} did not load in the child: ${l.controllerError})`;
  if (l.pass && !l.wrapped) return ` (pass.js exports ${show(l.pass)}; the test could not wrap handleRunTaskForPass)`;
  return '';
}
const OLD_ENQUEUE = ['runViaQueueAsync', 'runViaQueueSync', 'enqueueTask'];
const oldEnqueues = (x) => x.oldPath.filter((c) => OLD_ENQUEUE.includes(c.name));
/** Nothing lined up, recorded or launched for this request (the world's queue, the record, the old path, child_process). */
function mwNothingProblems(label, x) {
  const p = [];
  if (x.adds.length) p.push(`${label}: lined up ${show(x.adds)}`);
  if (x.recordWrites) p.push(`${label}: wrote the record ${x.recordWrites} time(s)`);
  if (oldEnqueues(x).length) p.push(`${label}: the old run-task path enqueued it (${show(oldEnqueues(x))}) — the silent-join path ${adr('D7')} replaces for this pass`);
  if (x.spawns.length) p.push(`${label}: launched a process: ${show(x.spawns.map((s) => s.call))}`);
  return p;
}
/** The delegate's 200 through the real stack, and who it recorded. */
function mwLinedUpProblems(label, x, who) {
  const p = [];
  if (x.delegateCalls !== 1) p.push(`${label}: the run-task branch should reach pass.js's handleRunTaskForPass once (${adr('D7')}: "return await require('../../tagging-edges/pass').handleRunTaskForPass(req, res)"); it was reached ${x.delegateCalls} time(s)${mwWhy()}`);
  if (x.status !== 200 || !x.body || x.body.success !== true || x.body.message !== LINED_UP_MESSAGE || x.body.queued !== true || typeof x.body.jobId !== 'string' || !LINEUP_ID.test(x.body.jobId)) {
    p.push(`${label}: should answer 200 { success: true, message: ${show(LINED_UP_MESSAGE)}, queued: true, jobId: <LINEUP_ID> } (${adr('D7')}); it answered ${x.status} ${show(x.body)}`);
  }
  if (x.adds.length !== 1) p.push(`${label}: exactly one job should be added through the controller; adds ${show(x.adds)}`);
  if (oldEnqueues(x).length) p.push(`${label}: the old path enqueued it as well: ${show(oldEnqueues(x))}`);
  if (x.spawns.length) p.push(`${label}: launched a process: ${show(x.spawns.map((s) => s.call))}`);
  const e = x.record && x.record.passes && x.body && x.record.passes[x.body.jobId];
  if (who && (!e || !e.start || exact(e.start.who) !== exact(who))) p.push(`${label}: the record's start should carry who ${show(who)}; the record is ${show(x.record)}`);
  p.push(...leakProblems(label, x.body));
  return p;
}

test('PX32: an admin is admitted with only pass.js\'s defaults — in a child process whose brainstorm.conf (BRAINSTORM_CONF_PATH) names the owner and whose settings file (TAPESTRY_SETTINGS_PATH) names the admin, defaultDeps\' getAdminPubkeys answers [the admin]; the admin\'s record read with no deps injected answers 200, and so does the owner\'s, while a stranger\'s is refused 403; with Express\'s next as the third argument the admin is still admitted and next is never called [ADR tagging-edges/0006 Implementation notes ("must include getAdminPubkeys (the SWR74 trap)"), D13; ADR tagging-edges/0005 D5; the DR22 precedent for next]', () => {
  const run = middlewareRun();
  assert(run.data, `the child produced nothing: ${run.error}`);
  const d = run.data.defaults;
  assert(d, `pass.js's defaults could not be checked in the child${mwWhy() || ` (${MODULES.pass} did not load)`}`);
  const p = [];
  if (!d.hasGetAdminPubkeys) p.push(`defaultDeps (${d.type}) has no getAdminPubkeys function${d.callError ? ` (defaultDeps() threw: ${d.callError})` : ''}`);
  else if (exact(d.admins) !== exact([ADMIN])) p.push(`defaultDeps' getAdminPubkeys() should answer the configured admin; it answered ${show(d.admins)}${d.adminsError ? ` (threw: ${d.adminsError})` : ''}`);
  const g = d.gets || {};
  const st = (k) => (g[k] ? (g[k].error ? `error: ${g[k].error}` : `${g[k].status} ${show(g[k].body)}${g[k].rejected ? ` (rejected: ${g[k].rejected})` : ''}`) : 'not run');
  if (!g.admin || g.admin.status !== 200) p.push(`the admin's record read with only the defaults should answer 200; it answered ${st('admin')}`);
  if (!g.owner || g.owner.status !== 200) p.push(`the owner's record read with only the defaults should answer 200; it answered ${st('owner')}`);
  if (!g.stranger || g.stranger.status !== 403) p.push(`a stranger's record read with only the defaults should answer 403 (so the check ran); it answered ${st('stranger')}`);
  const n = g['admin, with next'];
  if (!n || n.status !== 200 || n.nextCalls) p.push(`with Express's next as the third argument, the admin should still be admitted (200) and next never called; it answered ${st('admin, with next')}, next called ${n ? n.nextCalls : '?'} time(s)`);
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX33–PX37 — POST /api/run-task through the real middleware and the real handleRunTask (child process)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test('PX33: on /api/run-task?taskName=reconcileTaggingEdges through the real auth middleware and the real handleRunTask, a signed-out request is refused 401 { success: false, error: "Sign in as the owner or an admin to do this." } and a signed-in stranger 403 { success: false, error: "Only the owner or an admin can do this." } — the middleware\'s bodies, with no message — the delegate is never reached, and nothing is lined up, recorded or launched; the owner\'s request through the same app does reach the delegate and lines up one pass [AC-4 "A signed-out caller or a signed-in stranger is refused by the middleware with no sentence"; ADR tagging-edges/0006 D7 "Who never reaches the delegate", § Seams "The run-task route through the middleware"]', () => {
  const p = [];
  for (const [id, want] of [['signed-out', { status: 401, body: MW_401 }], ['stranger', { status: 403, body: MW_403 }]]) {
    const x = mwGet(id);
    if (x.status !== want.status || exact(x.body) !== exact(want.body)) p.push(`${id}: should answer ${want.status} ${show(want.body)} (the middleware's own body); it answered ${x.status} ${show(x.body)}`);
    if (x.delegateCalls) p.push(`${id}: reached the delegate ${x.delegateCalls} time(s)`);
    if (x.worldCalls.length) p.push(`${id}: the delegate's deps were called: ${show(x.worldCalls)}`);
    p.push(...mwNothingProblems(id, x));
  }
  p.push(...mwLinedUpProblems('the owner (the paired positive)', mwGet('owner'), H.whoOf('owner')));
  report(p);
});

test('PX34: through the real middleware, the owner and an admin each line up this pass with D7\'s 200 and are recorded with role and shortened key; the owner from another site is refused by the delegate 403 { success: false, error: "cross-site request refused", message } with nothing lined up or recorded; a direct local call (loopback, no forwarding header) lines up a pass recorded as { kind: "local" }; a local call carrying another site\'s Origin is refused 403 cross-site [AC-4 "it refuses … a request from another site", "Requests the app already trusts as direct local calls stay exempt from the who-may check … but not from the rest"; AC-5 "a local call"; ADR tagging-edges/0006 D7]', () => {
  const p = [];
  p.push(...mwLinedUpProblems('the owner', mwGet('owner'), H.whoOf('owner')));
  p.push(...mwLinedUpProblems('an admin', mwGet('admin'), H.whoOf('admin')));
  p.push(...mwLinedUpProblems('a direct local call', mwGet('local'), { kind: 'local' }));
  for (const id of ['owner-other-site', 'local-other-site']) {
    const x = mwGet(id);
    if (x.delegateCalls !== 1) p.push(`${id}: the refusal should be the delegate's (it was reached ${x.delegateCalls} time(s))${mwWhy()}`);
    if (x.status !== 403 || !refusedBody(x.body, EXSITE) || typeof x.body.message !== 'string' || !x.body.message.trim()) p.push(`${id}: should answer 403 { success: false, error: ${show(EXSITE)}, message } (${adr('D7')}); it answered ${x.status} ${show(x.body)}`);
    p.push(...mwNothingProblems(id, x));
  }
  report(p);
});

test('PX35: through the real middleware, while a pass is running the owner is refused 409 { code: "pass-busy", message: "A pass is already waiting or running. Nothing new was lined up." } and nothing is lined up or recorded; with the queue flag off this pass is refused 503 { code: "QUEUE_UNAVAILABLE", message } and the legacy direct spawn is never attempted (no child_process call during the request) [AC-1, AC-4 "it refuses plainly while a pass is busy"; ADR tagging-edges/0006 D7 "With the flag off this pass is refused, 503 QUEUE_UNAVAILABLE. It no longer takes the legacy direct spawn, which bypassed the queue and the heavy-task lock"]', () => {
  const p = [];
  const busy = mwGet('owner-busy');
  if (busy.delegateCalls !== 1) p.push(`a busy pass: the delegate should answer (it was reached ${busy.delegateCalls} time(s))${mwWhy()}`);
  if (busy.status !== 409 || !busy.body || busy.body.code !== 'pass-busy' || busy.body.message !== BUSY_MESSAGE || busy.body.success !== false) p.push(`a busy pass: should answer 409 { success: false, code: "pass-busy", message: ${show(BUSY_MESSAGE)} }; it answered ${busy.status} ${show(busy.body)}`);
  p.push(...mwNothingProblems('a busy pass', busy));
  const off = mwGet('owner-flag-off');
  if (off.status !== 503 || !off.body || off.body.code !== 'QUEUE_UNAVAILABLE' || typeof off.body.message !== 'string' || !off.body.message.trim()) p.push(`the flag off: should answer 503 { code: "QUEUE_UNAVAILABLE", message }; it answered ${off.status} ${show(off.body)}`);
  p.push(...mwNothingProblems('the flag off', off));
  report(p);
});

test('PX36: every query form that the registry would resolve to this pass reaches the branch — taskName[]=reconcileTaggingEdges and taskName[0]=reconcileTaggingEdges (arrays of one, which String() reads as the name) are lined up by the delegate, not by the old path — and no form starts this pass outside the delegate: a repeated taskName and taskName[a]= are never enqueued by the old path and launch nothing (the registry answers 404 for them, unless the delegate does) [ADR tagging-edges/0006 D7 "if String(taskName) === reconcileTaggingEdges … String() makes a repeated or bracketed query parameter compare the same"]', () => {
  const p = [];
  for (const id of ['owner-bracketed', 'owner-indexed']) p.push(...mwLinedUpProblems(id, mwGet(id), H.whoOf('owner')));
  for (const id of ['owner-repeated', 'owner-keyed']) {
    const x = mwGet(id);
    if (oldEnqueues(x).length || x.spawns.length) p.push(`${id}: the old path started this pass (${show(oldEnqueues(x))}, launches ${show(x.spawns.map((s) => s.call))})`);
    if (!x.delegateCalls && x.status !== 404) p.push(`${id}: not reaching the delegate, it should be the registry's 404; it answered ${x.status} ${show(x.body)}`);
  }
  report(p);
});

test('PX37: another task on /api/run-task is unaffected — reconcileRecent from the owner with another site\'s Origin is not refused cross-site and goes to the old path\'s queue as before, without reaching the delegate or recording anything; signed out it is the middleware\'s 401 and for a stranger its 403, as for every task (a pin of today\'s behaviour, which must hold after the branch lands) [AC-4 "Other tasks on that route are unchanged … they keep that gate and get none of the three"; ADR tagging-edges/0006 D7 "Every other task, and every existing literal (R1, R3, T12, T13), is unchanged"; test/task-routes-owner-admin.test.js T1-T3]', () => {
  const p = [];
  const x = mwGet('other-owner-other-site');
  if (x.delegateCalls) p.push(`${OTHER_TASK}: reached this pass's delegate ${x.delegateCalls} time(s)`);
  if (x.status === 403 || (x.body && x.body.error === EXSITE)) p.push(`${OTHER_TASK} from another site was refused cross-site: ${x.status} ${show(x.body)} — the site check is this pass's only`);
  if (!x.oldPath.some((c) => OLD_ENQUEUE.includes(c.name) && c.taskName === OTHER_TASK)) p.push(`${OTHER_TASK} should go to the old path's queue as before; old-path calls ${show(x.oldPath)}, answer ${x.status} ${show(x.body)}`);
  if (x.worldCalls.length || x.recordWrites || x.adds.length) p.push(`${OTHER_TASK} touched this pass's controller deps: calls ${show(x.worldCalls)}, record writes ${x.recordWrites}, adds ${show(x.adds)}`);
  for (const [id, want] of [['other-signed-out', { status: 401, body: MW_401 }], ['other-stranger', { status: 403, body: MW_403 }]]) {
    const y = mwGet(id);
    if (y.status !== want.status || exact(y.body) !== exact(want.body)) p.push(`${id}: should answer ${want.status} ${show(want.body)}; it answered ${y.status} ${show(y.body)}`);
    if (y.delegateCalls || y.oldPath.length) p.push(`${id}: reached a handler (delegate ${y.delegateCalls}, old path ${show(y.oldPath)})`);
  }
  report(p);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════
// PX38 — no who reaches a signed-out reader's public views, and none is logged (child process)
// ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

const clip = (v, n = 700) => { const s = show(v); return s.length > n ? `${s.slice(0, n)}…(${s.length} characters)` : s; };
const busyKeysOf = (body) => (body && body.control && Array.isArray(body.control.busy) ? body.control.busy.map((i) => i && i.key) : null);

test('PX38: after an admin\'s Run that the owner stops while it runs, the owner\'s Run that an admin takes out of line, and a direct local call\'s start that the owner takes out of line, a signed-out reader gets no who — the public status read while each pass waits or is being stopped and at the end, the held list, and the Task Explorer\'s data for this task (over an events.jsonl holding everything the process logged) carry no full or shortened key, no "who" member and no private kind name, and the status\'s control holds only D12\'s members — and nothing logged carries who: no structured event (read through a recording stand-in for structuredEvents, real logging off) and no console line from those actions and reads; the owner\'s gated record read in the same world does name each who, so the search finds who where it is [AC-5 "Who may read it … gets no who from any route, including the task system\'s public views of a run"; Test task "Server cases for AC-5" ("a signed-out read of the public status, the held list and the Task Explorer\'s run data for this pass carries no who"); ADR tagging-edges/0006 § Constraints ("Those four stay indistinguishable to a signed-out reader"; "Who never goes anywhere a signed-out reader can see: … events.jsonl metadata"), D11 "Who is never logged", D12 "a control member, with no who", D13]', () => {
  const run = middlewareRun();
  assert(run.data, `the child produced nothing: ${run.error}`);
  const w = run.data.who;
  assert(w, `the child ran no PX38 phase${run.error ? ` (${run.error})` : ''}`);
  assert(!w.error, `PX38's actions and reads could not all run in the child: ${w.error} (${adr('D6, D7, D9, D12, D13')})`);
  const p = [];
  const steps = Array.isArray(w.steps) ? w.steps : [];
  const reads = steps.filter((s) => s.kind === 'read');
  const readOf = (label) => reads.find((s) => s.label.includes(label));
  const { K1, K3 } = w.keys || {};

  // Each signed-out answer: a public read that carries no who.
  for (const s of reads) {
    if (s.rejected) p.push(`${s.label}: the handler rejected (${s.rejected})`);
    if (s.status !== 200) p.push(`${s.label}: a public read should answer 200; it answered ${s.status} ${clip(s.body)}`);
    const found = whoFound(JSON.stringify(s.body === undefined ? null : s.body));
    if (found.length) p.push(`${s.label} carries who (${found.join(', ')}) — AC-5 "gets no who from any route" (${adr('§ Constraints')}); the answer is ${clip(s.body)}`);
  }
  // A kind as a bare word ("local") is no needle, so the status's control member holds only D12's members.
  for (const s of reads.filter((x) => x.label.startsWith('the public status'))) {
    const c = s.body && s.body.control;
    if (!c || typeof c !== 'object') continue;
    const extra = Object.keys(c).filter((k) => !['queue', 'busy', 'gaveUp'].includes(k));
    if (extra.length) p.push(`${s.label}: control carries ${show(extra)} beside D12's queue, busy and gaveUp — a member under any other name could carry who (${adr('D12')}); control is ${clip(c)}`);
    for (const i of Array.isArray(c.busy) ? c.busy : []) {
      const more = i && typeof i === 'object' ? Object.keys(i).filter((k) => !BUSY_ITEM_MEMBERS.includes(k)) : ['(not an object)'];
      if (more.length) p.push(`${s.label}: the busy item ${show(i && i.key)} carries ${show(more)}, outside D12's ${show(BUSY_ITEM_MEMBERS)} (${adr('D12')}); the item is ${clip(i)}`);
    }
    if (c.gaveUp != null && (typeof c.gaveUp !== 'object' || Object.keys(c.gaveUp).some((k) => k !== 'key' && k !== 'at'))) p.push(`${s.label}: gaveUp should be { key, at } or null (${adr('D12')}); it is ${clip(c.gaveUp)}`);
  }
  // …and each read shows what it is about, so a missing who is not an empty answer.
  for (const [label, key] of [['while the admin\'s pass waits', K1], ['while the owner\'s stop of the admin\'s running pass is asked', K1], ['while the local call\'s pass waits', K3]]) {
    const s = readOf(label);
    const keys = busyKeysOf(s && s.body);
    if (!keys || !keys.includes(key)) p.push(`the public status ${label} should list ${show(key)} in control.busy, so it showed the pass whose who it must not carry (${adr('D12')}); control is ${clip(s && s.body && s.body.control)}`);
  }
  const asked = readOf('while the owner\'s stop');
  if (!asked || !asked.body || asked.body.running !== true) p.push(`the public status while the owner's stop is asked should show the pass running; it is ${clip(asked && asked.body)}`);
  const end = readOf('the public status, signed out, at the end');
  const latest = end && end.body && end.body.latest;
  if (!latest || latest.runId !== w.runId || latest.outcome !== 'stopped') p.push(`the public status at the end should show the stopped run ${show(w.runId)} as latest (outcome "stopped"); latest is ${clip(latest)}`);
  const held = readOf('the held list');
  if (!held || !held.body || held.body.success !== true || held.body.runId !== w.runId) p.push(`the held list at the end should answer for the stopped run ${show(w.runId)}; it answered ${clip(held && held.body)}`);
  const te = readOf('the Task Explorer');
  const teBody = te && te.body;
  if (!teBody || !teBody.task || teBody.task.name !== TASK || !teBody.rawEvents || teBody.rawEvents.available !== true || !JSON.stringify(teBody.rawEvents).includes('px38-sentinel')) {
    p.push(`the Task Explorer's data for ${TASK} should come from the events.jsonl the child wrote (${show(w.logFile)}): its task named ${TASK}, rawEvents available and holding the test's own sentinel line; it is ${clip(teBody)}`);
  }

  // Nothing logged carries who: the structured events (what events.jsonl would hold), the console, any launch.
  const events = Array.isArray(w.events) ? w.events : [];
  const badEvents = events.filter((e) => whoFound(JSON.stringify(e)).length);
  const lineText = JSON.stringify(Array.isArray(w.lines) ? w.lines : []);
  if (badEvents.length || whoFound(lineText).length) {
    p.push(`a structured event carries who (${whoFound(JSON.stringify(badEvents) + lineText).join(', ')}) — ${adr('D11')} "Who is never logged"; § Constraints: "events.jsonl metadata". The events: ${clip(badEvents.length ? badEvents : w.lines)}`);
  }
  const consoleLines = Array.isArray(w.console) ? w.console : [];
  const badLines = consoleLines.filter((l) => whoFound(`${l.text}\n${l.json}`).length);
  if (badLines.length) p.push(`${badLines.length} console line(s) carry who (${whoFound(badLines.map((l) => `${l.text}\n${l.json}`).join('\n')).join(', ')}) — ${adr('D11')} "Who is never logged": ${clip(badLines.slice(0, 3).map((l) => `[${l.level}] ${l.text}`))}`);
  if (!consoleLines.some((l) => String(l.text).includes('StructuredEventsAnalyzer: Loaded'))) p.push(`the console capture saw nothing of the Task Explorer read (no "StructuredEventsAnalyzer: Loaded" line), so it did not cover the reads; it saw ${clip(consoleLines.map((l) => l.text))}`);
  const spawns = Array.isArray(w.spawns) ? w.spawns : [];
  if (whoFound(JSON.stringify(spawns)).length) p.push(`a process launched meanwhile carries who in its arguments (${whoFound(JSON.stringify(spawns)).join(', ')}) — § Constraints: "process arguments": ${clip(spawns)}`);
  if (Array.isArray(w.directKills) && w.directKills.length) p.push(`the code under test called process.kill directly in the child (${show(w.directKills)}); a signal goes only through the injected kill(pid, signal) dep (${adr('D9')})`);

  // The positive control: who is in the gated record, so the search above would have found it there.
  const g = steps.find((s) => s.kind === 'gated');
  const gFound = g && g.status === 200 ? whoFound(JSON.stringify(g.body)) : [];
  const want = ['the owner\'s shortened key', 'an admin\'s shortened key', 'a member named "who"', 'the kind "owner"', 'the kind "admin"', 'the kind "local"'];
  const missing = want.filter((x) => !gFound.includes(x));
  if (missing.length) p.push(`the owner's gated record read should name each who of these actions (${adr('D11')}, D13), so the search above is shown to find who; it lacks ${missing.join(', ')}. It answered ${g ? `${g.status} ${clip(g.body)}` : 'nothing'}`);
  report(p);
});

test('PX39: a busy job added another way, under an id that D9\'s old rule refused but BullMQ accepts — "manual run", "job/1" and a 130-character id — is listed busy by its id, and an admin\'s Stop naming it with the pass\'s other open items answers 200, each taken out of line, recorded under its own key; the gate then skips each at pickup, one already picked up and waiting for the heavy-task lock abandons its wait, nothing busy remains, and a Run lines up — whether the odd jobs wait in line beside the owner\'s pass or one of them waits for the lock [ADR tagging-edges/0006 Amendment 1 § A ("A key is any string of 1 to 256 characters with no control character; the server only compares it with its own busy list"), § "What D9\'s body rule got wrong" (D9 step 2 made every Stop fail while such a job was busy); D5 (every job keyed by its BullMQ id), D9 steps 2 and 4, D3 (skip at pickup, shouldAbandon); R3]', async () => {
  const LONG = 'nightly-run.'.repeat(11).slice(0, 130);
  const ODD = ['manual run', 'job/1', LONG];
  // Setup: BullMQ's own validation (no Redis) accepts each id, as the fake queue's add does (probe P1).
  for (const id of ODD) {
    const why = H.bullmqRejects(id);
    assert(why === null, `setup: BullMQ should accept the job id ${show(id)}; it refused it: ${why}`);
  }
  const addOdd = (s, id) => s.world.queue.add(TASK, H.lineUpData(), H.lineUpOpts(id));
  await cases([
    {
      name: 'the odd jobs wait in line beside the owner\'s pass',
      setup: async (s) => {
        const r1 = await s.run('owner');
        assert(r1.status === 200 && typeof r1.body.key === 'string', `setup: the owner's Run should line up a pass; it answered ${showRes(r1)}`);
        for (const id of ODD) await addOdd(s, id);
        return { keys: [r1.body.key, ...ODD], lockWait: null };
      },
    },
    {
      name: 'one odd job was picked up and waits for the heavy-task lock, the others wait in line behind it',
      setup: async (s) => {
        await addOdd(s, 'job/1');
        const job = s.world.queue.pickUp();
        assert(job && job.id === 'job/1', `setup: job/1 should be picked up; got ${show(job && job.id)}`);
        const v = await s.ctl.gate.beforeAcquire(job);
        assert(v === 'go', `setup: gate.beforeAcquire(job/1) should answer 'go' (a start "another way"); it answered ${show(v)}`);
        await addOdd(s, 'manual run');
        await addOdd(s, LONG);
        return { keys: ['job/1', 'manual run', LONG], lockWait: job };
      },
    },
  ], async (c) => {
    const s = scene();
    const { keys, lockWait } = await c.setup(s);
    s.world.clock.advance(MIN);
    const snap = await s.ctl.snapshot({ fresh: true }, { fresh: true });
    const items = (snap && (snap.items || snap.busy)) || [];
    const p = [];
    const listed = items.map((it) => it.key);
    if (keys.some((k) => !listed.includes(k)) || listed.length !== keys.length) p.push(`the busy list should hold exactly ${show(keys)}, each job keyed by its BullMQ id (${adr('D5')}); it holds ${show(listed)}`);
    for (const it of items) if (it.state !== 'waiting' || it.stopAskedAt != null) p.push(`${show(it.key)} should be waiting with no stop asked for; it is ${show(it)}`);
    report(p);
    const stopAt = iso(s.world.clock.now());
    const m = s.mark();
    const r = await s.stop('admin', items.map((it) => ({ key: it.key, state: it.state })));
    const d = s.since(m);
    if (r.status !== 200) {
      throw new Error(`the admin's Stop naming every open item should answer 200 (${adr('Amendment 1 § A')}: the server only compares a key with its own busy list); it answered ${r.status} ${show(r.body)}`);
    }
    const byKey = (x, y) => String(x.key).localeCompare(String(y.key));
    const want = keys.map((key) => ({ key, how: 'taken-out-of-line' })).sort(byKey);
    const got = Array.isArray(r.body.stopped) ? r.body.stopped.map((x) => ({ key: x.key, how: x.how })).sort(byKey) : null;
    if (exact(got) !== exact(want) || r.body.recorded !== true) p.push(`the Stop should answer { success: true, stopped: ${show(want)}, recorded: true }; it answered ${show(r.body)}`);
    if (d.kills.length) p.push(`waiting passes get no signal; kills ${show(d.kills)}`);
    const rec = s.record_();
    for (const key of keys) {
      const own = !!rec && !!rec.passes && Object.prototype.hasOwnProperty.call(rec.passes, key);
      const e = own ? rec.passes[key] : null;
      if (!e || e.skip !== true || !e.stop || e.stop.at !== stopAt || exact(e.stop.who) !== exact(H.whoOf('admin'))) {
        p.push(`the record should hold ${show(key)}'s own entry with skip true and the admin's stop at ${stopAt} (${adr('D11')}); it holds ${show(e)}`);
      }
      if (!historyOf(rec).some((l) => l && l.action === 'stop' && l.key === key)) p.push(`the history should hold a stop line for ${show(key)}`);
    }
    if (lockWait) {
      if (s.ctl.gate.shouldAbandon(lockWait) !== true) p.push(`job/1, waiting for the heavy-task lock, should abandon its wait (${adr('D3')} shouldAbandon)`);
      const v = await s.ctl.gate.afterAcquire(lockWait);
      if (v !== 'skip') p.push(`job/1 should be skipped once the lock is won; afterAcquire answered ${show(v)}`);
      s.world.queue.complete(lockWait.id, s.ctl.gate.skipped(lockWait));
      s.ctl.gate.ended(lockWait);
    }
    for (;;) {
      const job = s.world.queue.pickUp();
      if (!job) break;
      const v = await s.ctl.gate.beforeAcquire(job);
      if (v !== 'skip') p.push(`${show(job.id)}, taken out of line, should be skipped at pickup; beforeAcquire answered ${show(v)}`);
      s.world.queue.complete(job.id, s.ctl.gate.skipped(job));
      s.ctl.gate.ended(job);
    }
    const after = await s.ctl.snapshot({ fresh: true }, { fresh: true });
    const left = ((after && (after.items || after.busy)) || []).map((it) => it.key);
    if (left.length) p.push(`nothing should be busy once each was skipped; busy: ${show(left)}`);
    s.world.clock.advance(SEC);
    const again = await s.run('owner');
    p.push(...statusProblems('a Run afterwards', again, 200));
    report(p);
  });
});

// ─── runner ────────────────────────────────────────────────────────────────────────────────────────────────────
async function run() {
  console.log('\n--- tagging-edges pass routes tests (epic tagging-edges, Story 6 — ADR 0006 D6, D7, D9, D11, D13, D14; AC-1, AC-3, AC-4, AC-5) ---');
  let pass = 0;
  let fail = 0;
  const failures = [];
  const saved = { dir: process.env.TAGGING_EDGES_STATE_DIR, log: process.env.BRAINSTORM_STRUCTURED_LOGGING };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tagging-edges-pass-routes-'));
  const strays = [];
  const onUnhandled = (reason) => { strays.push(`unhandled rejection: ${firstLine(reason)}`); };
  process.on('unhandledRejection', onUnhandled);
  // A fake pid (5001 and up, 4242) must never reach a real process: process.kill refuses every call until the end.
  const killGuard = H.guardProcessKill({ label: 'the PX suite' });
  try {
    process.env.TAGGING_EDGES_STATE_DIR = root;
    process.env.BRAINSTORM_STRUCTURED_LOGGING = 'false';
    for (const [name, fn] of tests) {
      strays.length = 0;
      const killsBefore = killGuard.directKills.length;
      let err = null;
      try { await fn(); } catch (e) { err = e; }
      const left = cleanupWorlds();
      await new Promise((r) => { setImmediate(r); });
      if (!err && left.length) err = new Error(left.join('\n        '));
      if (!err && strays.length) err = new Error(`the test left ${strays.length} unhandled rejection(s): ${strays.join('; ')}`);
      if (killGuard.directKills.length > killsBefore) {
        const msg = `the code under test called process.kill directly (${show(killGuard.directKills.slice(killsBefore))}); a signal goes only through the injected kill(pid, signal) dep (${adr('D9')}; § Seams deps list)`;
        err = new Error(err ? `${err.message}\n        ${msg}` : msg);
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
    killGuard.restore();
    process.removeListener('unhandledRejection', onUnhandled);
    if (saved.dir === undefined) delete process.env.TAGGING_EDGES_STATE_DIR; else process.env.TAGGING_EDGES_STATE_DIR = saved.dir;
    if (saved.log === undefined) delete process.env.BRAINSTORM_STRUCTURED_LOGGING; else process.env.BRAINSTORM_STRUCTURED_LOGGING = saved.log;
    fs.rmSync(root, { recursive: true, force: true });
    MW = null;
  }
  console.log(`\ntagging-edges-pass-routes: ${pass} passed, ${fail} failed, 0 skipped`);
  return { pass, fail, skipped: 0, failures };
}

if (require.main === module) {
  run().then(({ fail }) => process.exit(fail === 0 ? 0 : 1)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
