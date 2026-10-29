/**
 * Job gates — the per-task opt-in to a gate in the Worker callback.
 * Story tagging-edges #6 / ADR tagging-edges/0006 D3.
 *
 * gateFor(taskName) returns the gate initTaskQueue wraps around a tagged
 * task's semaphore.acquire, or null. Only the gap-filling pass has one: the
 * default controller's gate, so the routes and the worker share one state.
 * Every other task gets null and keeps today's callback.
 *
 * The controller is required only when gateFor is called for the pass, so
 * loading this module (and queue/index.js) does no disk or Redis work and
 * makes no require cycle.
 */

function gateFor(taskName) {
  if (taskName !== 'reconcileTaggingEdges') return null;
  return require('../../../pipeline/tagging-edges/control').controller.gate;
}

module.exports = { gateFor };
