/**
 * The pass's job gate (tagging-edges story 6, ADR tagging-edges/0006 D3): what the task queue's worker callback asks
 * before the heavy-lock wait, at every lock poll, and after the lock is won, for the pass's jobs only (jobGates.js).
 *
 * makeGate(state, deps) builds it over a controller instance's state (index.js) and holds no state of its own:
 *   beforeAcquire(job)  a chain step. 'skip' for a job taken out of line or never to be run again (in memory or in the
 *                       record); otherwise it records a schedule's start (at the id's millis) or a start "another way"
 *                       (at job.timestamp), best effort, marks the job waiting for the lock and answers 'go'
 *   shouldAbandon(job)  synchronous: skips ∪ noRerun, so a Stop ends the lock wait at the next poll
 *   afterAcquire(job)   a chain step, and the waiting→running boundary: 'skip' when a Stop came first, else the job is
 *                       launched and it answers 'go'
 *   ended(job)          synchronous, in memory: the job is ending; its in-memory marks are dropped (the record keeps them)
 *   gaveUp(job, err)    a chain step that always resolves: the give-up, and gaveUpAt on the job's entry, best effort
 *   skipped(job)        the completed job's return value, { skipped: true, jobId }
 * The gate never reads Redis, and records no who for a start lineUp records (owner, admin, local, confirmation).
 */

function makeGate(state, deps) {
  const { step, keyOf, askedAt, isScheduled, isLineUpKey, loadRecord, entryOf, recordStart, recordGaveUp, bump } = state.ops;
  const marked = (key) => state.skips.has(key) || state.noRerun.has(key);

  function beforeAcquire(job) {
    return step(async () => {
      const key = keyOf(job);
      await loadRecord();
      const entry = entryOf(key);
      if (marked(key) || (entry && (entry.skip || entry.noRerun))) return 'skip';
      if (!(entry && entry.start)) {
        // A schedule's start cannot be refused, and one "another way" is best effort: a failed write goes ahead.
        if (isScheduled(job.id)) await recordStart(key, String(job.id), askedAt(job), { kind: 'schedule' });
        else if (!isLineUpKey(key) && !state.linedUp.has(key)) await recordStart(key, String(job.id), job.timestamp, { kind: 'other' });
      }
      state.phases.set(key, { jobId: String(job.id), phase: 'waiting-for-lock', since: deps.now() });
      bump();
      return 'go';
    });
  }

  function shouldAbandon(job) {
    return marked(keyOf(job));
  }

  function afterAcquire(job) {
    return step(async () => {
      const key = keyOf(job);
      if (marked(key)) return 'skip';
      state.phases.set(key, { jobId: String(job.id), phase: 'launched', since: deps.now() });
      bump();
      return 'go';
    });
  }

  function ended(job) {
    const key = keyOf(job);
    const now = deps.now();
    for (const [k, at] of state.endedKeys) if (now - at >= deps.timers.endedKeysMs) state.endedKeys.delete(k);
    state.phases.delete(key);
    state.endedKeys.set(key, now);
    state.skips.delete(key);
    state.noRerun.delete(key);
    bump();
  }

  function gaveUp(job) {
    return step(async () => {
      const key = keyOf(job);
      const at = deps.now();
      state.lastGaveUp = { key, at };
      try { await recordGaveUp(key, String(job.id), at); } finally { bump(); }
    }).catch(() => {});
  }

  function skipped(job) {
    return { skipped: true, jobId: job && job.id };
  }

  return { beforeAcquire, shouldAbandon, afterAcquire, ended, gaveUp, skipped };
}

module.exports = { makeGate };
