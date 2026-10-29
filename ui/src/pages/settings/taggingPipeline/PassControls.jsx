/**
 * Running and stopping the gap-filling pass (tagging-edges Story 6; ADR tagging-edges/0006 D17, D18): "Run a pass
 * now", the line beside it while the owner's confirmation of held removals is pending, the busy passes with who
 * started them, a pass that gave up waiting, "Stop" and the prompt it opens first, what the last Run's or Stop's
 * answer meant, and the last 10 actions, newest first.
 *
 * Run and Stop are the panel's (TaggingPipelinePanel.jsx runPass and stopPasses, through the fetch util's 15 s race),
 * and so is their state, passed down here as props, so a Retry or the switch from an empty report to a ready one
 * loses nothing. This file only renders and asks. The prompt is an inline confirmation that replaces "Stop" while
 * open; it says only what its snapshot holds, never what later polls show, and Cancel sends nothing.
 */

import { useEffect, useRef } from 'react';
import { stopPromptView } from '../../../utils/taggingPipelineView.js';
import { ReadFailed, TONE_COLOUR, when } from './parts.jsx';

/** A line the view gives as { text, at, end }: its text, then the server's time in the viewer's locale, then end. */
export function TimedLine({ line }) {
  return <>{line.text}{line.at && ` ${when(line.at)}`}{line.end}</>;
}

/** Who started a pass, and who asked it to stop, as passWho gives them ({ start, stop }). */
export function WhoLines({ who }) {
  return <><TimedLine line={who.start} />{who.stop && <>{' '}<TimedLine line={who.stop} /></>}</>;
}

/** The last Run's or Stop's outcome: its sentence, and the refusal's HTTP status or the failure's code and cause. */
function Outcome({ outcome }) {
  return (
    <p style={{ color: TONE_COLOUR[outcome.tone] }}>
      {outcome.text}
      {outcome.outcome === 'refused' && outcome.httpStatus !== null && ` HTTP status: ${outcome.httpStatus}.`}
      {outcome.code && <> Code: <code>{outcome.code}</code></>}
      {outcome.cause && <> Cause: <code>{outcome.cause}</code></>}
    </p>
  );
}

/**
 * The Stop prompt (ADR 0006 D16 stopPromptView, D17): a heading, what happens to each pass of the snapshot, and "Stop
 * the pass" (or "Stop the passes") and "Cancel". Focus moves to Cancel when it opens, through an effect, with no timer.
 * While the stop is under way it stays open, its buttons disabled.
 */
function StopPrompt({ stop, onStop, onCancel }) {
  const cancel = useRef(null);
  useEffect(() => {
    if (cancel.current) cancel.current.focus();
  }, []);
  const prompt = stopPromptView(stop.snapshot, stop.confirmation);
  const several = stop.snapshot.length > 1;
  return (
    <div className="settings-group" style={{ borderColor: TONE_COLOUR.warn }}>
      <h4>{several ? 'Stop the busy passes?' : 'Stop the busy pass?'}</h4>
      {prompt.blocks.map((b) => (
        <div key={b.key}>
          {b.lines.map((l, i) => <p key={i}><TimedLine line={l} /></p>)}
        </div>
      ))}
      {prompt.pending && <p>{prompt.pending}</p>}
      <p>
        <button
          className="btn-small"
          disabled={stop.pending}
          aria-busy={stop.pending ? 'true' : undefined}
          onClick={onStop}
        >
          {stop.pending ? 'Stopping…' : (several ? 'Stop the passes' : 'Stop the pass')}
        </button>{' '}
        <button className="btn-small" ref={cancel} disabled={stop.pending} onClick={onCancel}>Cancel</button>
      </p>
    </div>
  );
}

/**
 * `body` is the status body and `view` passView of it; `busy` is busyView of it; `who` is passWho of the pass record's
 * read (`record`) and the status body; `run` is the panel's { pending, outcome } and `stop` its { snapshot,
 * confirmation, pending, outcome }; `onRun()` sends a Run, `onAskStop()` opens the prompt, `onCancelStop()` closes it
 * and `onStop()` sends the stop it shows. Rendered only once the status has a body.
 */
export default function PassControls({
  body, view, busy, who, record, onRetryRecord, run, stop, onRun, onAskStop, onCancelStop, onStop,
}) {
  const control = body && body.control && typeof body.control === 'object' ? body.control : null;
  const gaveUp = control && control.gaveUp && typeof control.gaveUp === 'object' ? control.gaveUp : null;
  const whoOf = (key) => who.items.find((w) => w.key === key) || null;
  return (
    <div>
      <p>
        <button
          className="btn-small"
          disabled={run.pending}
          aria-busy={run.pending ? 'true' : undefined}
          onClick={onRun}
        >
          {run.pending ? 'Lining up a pass…' : 'Run a pass now'}
        </button>
      </p>
      {view.confirmation.state === 'pending' && (
        <p className="settings-hint">
          The owner's confirmation is pending. The next pass to get past its start checks takes it up.
        </p>
      )}
      {run.outcome && !run.pending && <Outcome outcome={run.outcome} />}
      {!busy.known && <p style={{ color: TONE_COLOUR.warn }}>{busy.why}</p>}
      {busy.items.length > 0 && (
        <ul>
          {busy.items.map((it) => {
            const w = whoOf(it.key);
            const stopLine = w && w.stop ? w.stop : it.stopLine;
            return (
              <li key={it.key}>
                <TimedLine line={it.line} />
                {w && <>{' '}<TimedLine line={w.start} /></>}
                {stopLine && <>{' '}<TimedLine line={stopLine} /></>}
              </li>
            );
          })}
        </ul>
      )}
      {gaveUp && (
        <p style={{ color: TONE_COLOUR.warn }}>
          A pass gave up waiting at {when(gaveUp.at)} and never began running, so it wrote nothing and left no report.
        </p>
      )}
      {stop.snapshot
        ? <StopPrompt stop={stop} onStop={onStop} onCancel={onCancelStop} />
        : busy.canStop && <p><button className="btn-small" onClick={onAskStop}>Stop</button></p>}
      {stop.outcome && !stop.pending && <Outcome outcome={stop.outcome} />}
      {who.status === 'failed' && (record.error
        ? <ReadFailed what={who.what} error={record.error} onRetry={onRetryRecord} />
        : <p style={{ color: TONE_COLOUR.bad }}>{who.text}</p>)}
      {who.status === 'loading' && <p className="settings-hint">{who.text}</p>}
      {who.status === 'shown' && who.history.length === 0 && <p className="settings-hint">{who.historyText}</p>}
      {who.status === 'shown' && who.history.length > 0 && (
        <div>
          <p className="settings-hint">Recent actions, newest first.</p>
          <ol>
            {who.history.map((h, i) => <li key={i}><TimedLine line={h} /></li>)}
          </ol>
        </div>
      )}
    </div>
  );
}
