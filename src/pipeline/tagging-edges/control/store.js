/**
 * The pass controller's record on the data volume (tagging-edges story 6, ADR tagging-edges/0006 D11).
 *
 *   <stateDir>/control/record.json   { version: 1, passes: { <key>: { jobId, start, stop, skip, noRerun, gaveUpAt } },
 *                                      history: [{ action, key, at, who }] } — who started and stopped each pass
 *
 * The directory is 0700 and the file 0600, written through state.writeAtomic (temp file, fsync, rename, directory
 * fsync), only by the controller, inside its chain. Every method is synchronous and nothing is touched until a method
 * is called. read() tells the three ways a record can be missing apart:
 *   null                              no file: reads as empty
 *   { unreadable: true, readError }   any other read error, with its code
 *   { damaged: true }                 a file that does not parse to an object
 * A damaged file is renamed aside (renameDamaged) before a fresh record is written, so its bytes are kept.
 */

const fs = require('fs');
const path = require('path');
const state = require('../state');

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** The store over `dir` (default <stateDir>/control, TAGGING_EDGES_STATE_DIR read when the store is made). */
function createStore({ dir } = {}) {
  const root = dir || path.join(state.stateDir(), 'control');
  const file = path.join(root, 'record.json');

  function read() {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      return { unreadable: true, readError: (err && err.code) || 'error' };
    }
    try {
      const parsed = JSON.parse(text);
      return isObject(parsed) ? parsed : { damaged: true };
    } catch (_) {
      return { damaged: true };
    }
  }

  function write(record) {
    state.writeAtomic(file, `${JSON.stringify(record, null, 2)}\n`);
  }

  /** Move a damaged record.json to record.json.damaged-<at> (at: an ISO time), keeping its bytes. */
  function renameDamaged(at) {
    fs.renameSync(file, `${file}.damaged-${at}`);
  }

  return { file, read, write, renameDamaged };
}

module.exports = { createStore };
