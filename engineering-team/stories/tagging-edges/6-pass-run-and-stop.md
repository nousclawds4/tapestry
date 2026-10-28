# Story 6: Running and stopping the pass, on the panel

**Status:** Approved
**Created:** 2026-10-02
**Type:** Feature

## Background

Stories 1–5 are in production. The gap-filling pass (story 2) and the real-time path (story 3) keep one `TAGS`
relationship per tagging. Story 4's panel (Settings › Relays › Tagging pipeline) shows both to the owner and admins.
Story 5 added the real-time path's switch to it, with a record of who changed it.

The book's acceptance frame asks that the owner, and admins since story 4's Planning, can manage the pipeline from the
control panel, "start / stop, and a gap-fill run on demand" included (`audits/tagging-edges/book.md`, "Front-end
controls"). The owner decided the pass's controls at story 5's Planning (2026-10-01; `epics/tagging-edges.md` item 6).
At this story's Planning (2026-10-02) the owner split them in two:
- **Story 6, this one: running and stopping a pass.** For the owner or an admin, with the waiting and stopping states
  every viewer sees, and a record of who did it.
- **Story 7: confirming held removals from the panel,** for the owner only, after a prompt.

Today:
- **The panel runs nothing.** A pass starts from the backstop schedule, from the Task Explorer pages, or from the
  general run-task route (OPERATIONS §12.8). The confirm route also starts one.
- **Anyone signed in can start a pass.** The run-task route checks only that a session is signed in, and so do the
  routes that add or enable a Scheduled Tasks entry (ADR `tagging-edges/0002` § Context; intake 2026-07-21).
  *(Corrected at Architecture, 2026-10-27: no longer so. Since 2026-10-10 the run-task route, and the routes that add, change or delete
  a Scheduled Tasks entry, admit only the owner, an admin or a direct local call, for every task
  (`security-auth-exposure` story 6, PR #840). Since story 8 the route table holds that rule
  (`src/middleware/routeAccess.js:365-372`, ADR `security-auth-exposure/0005`). The 2026-07-21 intake entry was picked
  up there, and its book closed on 2026-10-11. The route still checks no site, and still lines up a pass while one is
  busy.)*
- **Nothing on the panel or any route can stop a pass on request.** The pass already stops at its next safe point
  when it receives a stop signal, but nothing in the app sends one. Only the 30-minute time-out, or a container
  restart or deploy, ends a running pass early, and neither leaves a final report.
- **A pass waiting to start is invisible.** It can wait up to 4 hours behind scoring for the shared heavy-task lock.
  The panel shows only a pass whose process is alive.
- **A second request can quietly join a pass.** A request while a pass started on demand is waiting joins it, and is
  answered as queued. While a scheduled run is waiting, a request lines up a second pass behind it instead.
- **A start in the few seconds after an on-demand pass ends can be lost.** It joins the ending pass's job and is
  answered as queued, though no pass runs (ledger `2026-09-28-confirm-route-joins-finishing-job`; the row names the
  confirm route, but the run-task route shares the cause).
- **Nothing records who started or stopped a pass.**
- **How long a pass takes.** About 3 s on staging and 7 s on production (2026-10-02). A stop therefore mostly
  matters for a pass that is waiting to start, or one that is slow because the relay or the graph is.

Story 6 also carries story 5's review carry-forwards, C5-1 to C5-10 (below). They touch story 5's docs, test plan and
test comments, its ADR, one prompt and, optionally, one reason's copy; none changes what the pass does. The owner
placed them here (2026-10-01); they do not gate this story's criteria.

## User-facing description

As the owner or an admin of a Tapestry instance, I want to start a gap-filling pass, and stop one that is waiting or
running, from the Tagging pipeline panel:
- being told plainly when a pass is already waiting or running, instead of a second one quietly lining up;
- seeing, as every other viewer does, that a pass is waiting to start, or that a stop was asked for;
- seeing a pass I stopped read as stopped, not failed;
- seeing who started or stopped each pass, and when, with the recent history.

Then nobody needs the Task Explorer to run a pass, and only the owner and admins (and direct local calls) can start one
from the panel or the run-task route. Adding or enabling a Scheduled Tasks entry also starts one; who may do that stays
with the 2026-07-21 intake sweep (Out of scope). *(Corrected at Architecture, 2026-10-27: the run-task half of the first sentence has held for every
task since 2026-10-10. Since then, only the owner, admins and direct local calls may add or enable a Scheduled Tasks
entry. The intake sweep shipped on 2026-10-11 (Background). This story keeps both.)*

## Acceptance criteria

The terms are story 4's and story 5's: "the panel", "the pass", "the path", "the report", "owner" and "admin". In
addition:
- **Waiting.** A pass is waiting when it has been asked for, or a scheduled run's time has come, and it has not yet
  begun running, including one held behind scoring for the shared heavy-task lock, or behind another pass. The
  backstop's next scheduled run, whose time has not come, is never waiting.
- **Running.** As story 4 shows it: the pass's process is alive.
- **Busy.** From the moment a pass is asked for, or a scheduled run's time comes, until the pass ends. There is no
  moment in between when it shows as neither waiting nor running, and a Run or a Stop at any such moment is treated as
  for a busy pass.
- **Ended.** A pass ends with its outcome (story 2's, or this story's "stopped on request").
- **Safe point.** A point between the pass's steps, or between its write batches, where it checks for a stop today
  (ADR `tagging-edges/0002`).
- **Action.** A start (a pass asked for, or a scheduled run's time coming, by any of AC-5's kinds of "who") or a stop
  that the server accepts. Its time is when it was asked for, not when the pass began running.

- [ ] **AC-1. Run a pass now.**
  - **What it shows.** In the panel's pass section, the owner and admins see a "Run a pass now" control. Pressing it
    asks nothing.
  - **When nothing is busy,** the server lines up a pass. Within 10 seconds every viewer sees it waiting, running, or
    ended with its outcome.
  - **When a pass is busy,** the server refuses plainly: a pass is already waiting, or running. Nothing new is lined
    up. That holds for a scheduled run whose time has come and that is waiting. When more than one pass is busy, the
    panel shows each.
  - **Just after a pass ends.** A Run in the few seconds after a pass ends either lines up a new pass or is refused
    plainly. It is never answered as lined up when no pass will run.
  - **When the task queue is unavailable,** the server refuses plainly and starts nothing.
  - **While a Run is under way,** the control is disabled and says so. If the server has not answered within 15
    seconds, the control is enabled again and the panel says the outcome is unknown. It then shows the state from its
    next read.
  - **When the owner's confirmation of held removals is pending,** the panel says beside the control that the next
    pass to get past its start checks takes it up.
- [ ] **AC-2. Waiting and stopping, seen by every viewer.**
  - **What the server reports, for each busy pass:**
    - whether it is waiting or running, and since when;
    - what a waiting pass waits behind: a pass ahead of it, or other heavy database work such as scoring;
    - whether a stop has been asked for it, and since when.
  - **Every viewer sees the same,** whoever pressed, and a reload keeps it.
  - **When the server cannot tell whether a pass is waiting,** every viewer is told so. It is never shown as nothing
    waiting.
  - **A waiting pass that gives up** without starting (after 4 hours behind other heavy database work) stops showing
    as waiting, and the panel says it gave up waiting and never began running. It leaves no pass report, and the
    history keeps its start.
  - **The public status** may say that a pass is waiting or that a stop was asked for, and when. It never says who
    (AC-5).
- [ ] **AC-3. Stop.**
  - **What it shows.** While some busy pass has no stop asked for, the owner and admins see "Stop". Otherwise it is
    not shown. It never applies to the backstop's next scheduled run, whose time has not come.
  - **What it acts on.** A stop acts on every busy pass that has no stop asked for when it is confirmed, and never
    does more than its prompt said. If what is busy has changed since the prompt opened (a waiting pass has begun
    running, or another pass has lined up), the stop is refused plainly and changes nothing. The panel then shows the
    new state, so the viewer can press Stop again.
  - **A prompt comes first.** Pressing "Stop" opens a prompt before anything changes. When more than one pass is busy,
    it says what happens to each. It says:
    - **for a waiting pass:** that it is taken out of line before it begins running, so it writes nothing, and that
      no schedule entry changes;
    - **for a running pass:**
      - that it stops at its next safe point, usually within seconds; when the graph or the relay is slow it can
        take several minutes, and at worst it runs until its 30-minute time-out;
      - that everything it wrote before then stands, and the next pass finishes the rest;
      - that no schedule entry changes;
    - **about the owner's confirmation of held removals:**
      - if the running pass has taken up the confirmation, or the panel cannot yet tell whether it has, the prompt
        warns that stopping then uses it up, and that the owner must confirm again after a later pass holds those
        removals again;
      - a running pass stopped before it takes the confirmation up leaves it pending for the next pass, and so does a
        waiting pass taken out of line.
  - **Cancelling** the prompt sends nothing and changes nothing.
  - **While a stop is under way,** the prompt's confirm is disabled and says so. If the server has not answered within
    15 seconds, the prompt closes, the panel says the outcome is unknown, and it then shows the state from its next
    read.
  - **Confirming a stop of a waiting pass:**
    - the pass never begins running;
    - within 10 seconds every viewer sees it gone from the line;
    - it leaves no pass report, so the latest pass and its held list stay as they were.
  - **Confirming a stop of a running pass:**
    - every viewer sees that a stop was asked for, until the pass ends;
    - a pass that stops at a safe point shows its own outcome, "stopped on request by <who> at <the time the stop was
      asked for>", not "failed";
    - what it wrote before stopping stands;
    - a stop that reaches it before it takes up the owner's confirmation leaves that confirmation pending.
  - **A stop that comes too late.** A pass can end another way before its next safe point: it finishes, is refused,
    fails, hits its time-out, or is ended by a deploy or a restart. Its outcome is then what it was, and the panel says
    the stop came too late to take effect.
  - **No force-stop.** A running pass that does not reach a safe point is not ended early. The "stop asked for" state
    stays shown until the pass ends.
  - **Nothing to stop.** A stop is refused plainly, and changes nothing, when nothing is busy or every busy pass
    already has a stop asked for. A pass that lines up after a stop was asked for is not covered by that stop, and
    Stop applies to it in its turn.
  - **The schedule.** A stop never changes any schedule entry. A scheduled run that is taken out of line skips that
    one run, and the next one comes at its usual time.
- [ ] **AC-4. Who may.**
  - **The server decides.** It accepts a Run or a Stop only from a signed-in owner or admin. It refuses everyone else,
    and changes and records nothing:
    - a signed-out request;
    - a signed-in user who is neither owner nor admin;
    - a request from another site.
  - **The general run-task route, for this pass,** answers as Run does:
    - it refuses anyone but a signed-in owner or admin, and a request from another site;
    - it refuses plainly while a pass is busy, and is never answered as lined up when no pass will run (AC-1);
    - a refused request records nothing.

    Requests the app already trusts as direct local calls stay exempt from the who-may check
    (`src/middleware/auth.js`'s local-trust rule), but not from the rest. The Task Explorer pages keep working for the
    owner and admins, and show the refusal. Other tasks on that route are unchanged.

    *(Corrected at Architecture, 2026-10-27: the who-may half of the first sub-bullet has held for every task since 2026-10-10, at the
    auth middleware's route table, with direct local calls passing (`src/middleware/auth.js:356-371`; Background).
    - This story keeps that half. For this pass it adds three things: the refusal of another site, the refusal while
      busy, and the record.
    - "Unchanged" for other tasks means they keep that gate and get none of the three.
    - A signed-out caller or a signed-in stranger is refused by the middleware with no sentence, so the Task Explorer's
      modal says "Task failed". Every refusal the owner or an admin can get there carries one.)*
  - **Either may act on the other's pass.** An admin may stop a pass the owner started, and the other way round. That
    includes a pass that is applying the owner's confirmation, after the prompt's warning (AC-3).
  - **Refused or failed.** When the server refuses the panel's request, or cannot carry it out, the panel shows the
    reason and the pass's state unchanged. A refusal can come from a lapsed session, or from a viewer who is no longer
    owner or admin.
- [ ] **AC-5. Who did it.**
  - **What is recorded.** Every action records who took it and when. "Who" is one of:
    - the owner or an admin, with a shortened key, from the panel or the run-task route;
    - the schedule, for a run a Scheduled Tasks entry starts, including the first run that adding or enabling an
      entry starts;
    - the owner's confirmation, for a pass the confirm route started;
    - a local call, for a start from a direct local request;
    - "started another way" when the server cannot tell, for example a job added from the queue dashboard.
  - **Only what happened is recorded.** A request that lines up no new pass records no start.
  - **When the server cannot record an action:**
    - a Run is refused and changes nothing;
    - a Stop still takes effect, its answer says it was not recorded, and the panel shows it with no "who";
    - a start that cannot be refused (a schedule's, or the confirm route's) goes ahead, and shows as not recorded;
    - the history recorded before it survives.
  - **What the panel shows:**
    - for each pass it shows, who started it, and who asked it to stop, if anyone;
    - the last 10 actions, newest first.
  - **Before story 6.** A pass from before this story shows its start as not recorded. With no action recorded, the
    panel says so and the history is empty.
  - **It lasts.** The record survives restarts and deploys.
  - **Who may read it.** Only a signed-in owner or admin may read who took an action, and the server enforces it. A
    signed-out reader, or a signed-in user who is neither, gets no "who" from any route, including the task system's
    public views of a run.
- [ ] **AC-6. Nothing else moves.**
  - **Run and Stop change nothing else.** They do not change any schedule entry or the real-time path's switch.
    Follows, mutes and reports are untouched.
  - **The pass behaves as story 2 defines.** It writes, holds and refuses as before. A pass that stops at a safe point
    leaves what it wrote. When the path is on, it catches up after a pass ends as story 3 defines, a stopped pass
    included.
  - **The confirm route** and its console snippet work as before; story 7 adds the panel's Confirm.
  - **The panel's reads still change nothing.** Nothing else on the panel or in Settings changes, apart from:
    - this story's controls, prompt, states and record;
    - the panel's opening line, which today says it changes nothing but the path's switch;
    - the pass section's line on how a pass starts, which names Run;
    - the copy that carry-forward C5-4 changes, if it is fixed in the panel;
    - the copy for a schema check that failed with an error carrying no code, if carry-forward C5-6 is taken;
    - the references to story 6 that the docs tasks point at story 7.

### Docs tasks

- **OPERATIONS §12.8.**
  - **Running it.** The panel's Run is the way to start a pass, for the owner or an admin. The run-task route now
    starts this pass only for them, and for direct local calls, and refuses while a pass is busy. *(Corrected at Architecture, 2026-10-27: "only for
    them, and for direct local calls" has held for every task since 2026-10-10, so `:721`'s "(signed in)" is stale and
    is corrected too. What is new for this pass is the refusal of another site and the refusal while busy.)*
  - **Stopping it.** The panel's Stop: what it does to a waiting pass and to a running one, the safe points, the
    stopped outcome, and the warning about the owner's confirmation.
  - **The panel.** Its paragraph says the panel runs and stops a pass. Confirming stays the console snippet's until
    story 7.
- **BIBLE.**
  - §11: the routes for Run and Stop, the run-task route's answers for this pass, and any route added to read the
    record.
  - §6: a waiting pass, a stop asked for, the stopped outcome, and who started or stopped a pass.
  - A §16 entry, and the Last-updated line.
- **ADR `tagging-edges/0002` (the Architect).** Amend it for run, stop, the stopped outcome, who started a pass and the
  run-task route's answers for this pass. Its § Context's open-route sentence changes for this pass. *(Corrected at Architecture, 2026-10-27: that
  sentence (`:89-95`) has been stale for every task since 2026-10-10, and the `src/middleware/auth.js` lines it cites
  are gone. D8's options A and B (`:232-235`), `:487-492` and § Out of scope `:1247` rest on the same facts. Their dated
  notes say so (ADR `tagging-edges/0006` § Amendments).)*
- **Point Confirm at story 7.** The places that still give Confirm to story 6 are:
  - BIBLE §16 (`:1484`; *corrected at Architecture, 2026-10-27: `:1504` at `48de58a7`*);
  - OPERATIONS §12.8 (`:725`);
  - ADR 0002 `:551`, `:820` (decision 14's note) and `:1243`; ADR 0003 `:944`; ADR 0004 `:370` and `:879`; ADR 0005
    `:610`, `:626`, `:667`, `:743`, `:748`, `:752`, `:755` and `:760`. These get dated notes by the Architect; the
    original text stays;
  - the panel's comments, in `HeldSection.jsx:4` and `TaggingPipelinePanel.jsx:7`.

  The epic, the book and the handoff (its title, § 0, § 1's table and § 3) were pointed at story 7 at this Planning.
- **The handoff § 0 and the epic** follow at the ship. *(Corrected at Architecture, 2026-10-27: these are already stale since 2026-10-10, and are
  corrected then:
  - the handoff's § 0 (`docs/TAGGING_EDGES_HANDOFF.md:72-73`) and § 2.3 (`:155`, `:166`);
  - the epic's item 6 (`epics/tagging-edges.md:165-168`), whose run-task and Scheduled Tasks halves the route table has
    settled.)*

### Test tasks

- **Server cases for AC-1 and AC-4:**
  - owner and admin, each starting a pass;
  - a Run refused while a pass is waiting, waiting behind scoring, running, or a scheduled run that has come due is
    waiting;
  - a Run in the moments after a pass ends: a pass runs, or the answer says plainly that none will;
  - a Run with the task queue unavailable;
  - each refused caller, for Run and for Stop;
  - an admin stopping a pass the owner started, including one that has taken up the owner's confirmation; the owner
    stopping an admin's;
  - the run-task route for this pass: the owner and an admin allowed; a signed-in user who is neither refused, and
    signed out refused; another site refused, with nothing lined up or recorded; a direct local call allowed and
    recorded as one; refused while busy, and just after a pass ends, as Run is; another task unaffected.
    *(Corrected at Architecture, 2026-10-27: the signed-out 401 and the signed-in stranger's 403 on this route have been the auth
    middleware's for every task since 2026-10-10, pinned by `test/task-routes-owner-admin.test.js` T1–T3 and T5.
    - This story's cases show them for this pass through the real middleware in front of the real handler, with
      nothing lined up or recorded.
    - Beside them are the new cases: the refusal of another site, the local-call record, and the busy answers.)*
  - after a Run and after a Stop, the schedule entries and the path's switch unchanged.
- **Server cases for AC-2:**
  - waiting (asked for; behind other heavy work; behind a pass ahead of it; a scheduled run that has come due), each
    with since when;
  - a stop asked for, with since when;
  - the same answer for every reader;
  - the server unable to tell whether a pass is waiting;
  - a waiting pass that gives up after 4 hours;
  - the public status, read signed out while a pass waits and while a stop is asked for, says when and never who.
- **Server cases for AC-3:**
  - a stop of a waiting pass: it never begins running, leaves no report, and a pending confirmation is still pending;
  - a stop of a scheduled run that has come due and is waiting: it never begins running, and the next scheduled run
    comes at its usual time;
  - a stop of a running pass at a safe point: the outcome, the record, and what was written stands;
  - a stop of a running pass before it takes up a pending confirmation: still pending;
  - a stop of a pass that has taken up the owner's confirmation: the confirmation is used up;
  - a stop whose prompt is out of date (a waiting pass has begun running, or another has lined up): refused, nothing
    changed;
  - a scheduled run that comes due while a stopped pass is still running: it can itself be taken out of line;
  - a stop that comes too late, including a pass refused at its start checks;
  - a stop with nothing busy, and a second stop;
  - the schedule entries unchanged after each.
- **Server cases for AC-5:**
  - each kind of "who", including a pass started by adding or enabling a schedule entry, recorded as the schedule;
  - a request that lines up no new pass records no start;
  - a record that cannot be written: a Run refused, a Stop taking effect unrecorded, a scheduled start shown as not
    recorded;
  - the last 10; a pass from before story 6; refused readers of "who";
  - after an owner's and an admin's Run and Stop, a signed-out read of the public status, the held list and the Task
    Explorer's run data for this pass carries no "who".
- **Browser cases** on the rebuilt UI:
  - AC-1: Run with nothing busy; refused while busy; two passes busy; under way; no answer within 15 seconds; the
    pending-confirmation line.
  - AC-2: waiting, behind other heavy work and behind a pass ahead of it; a stop asked for; each seen by a viewer who
    did not press, and after a reload; the server unable to tell; a waiting pass that gave up.
  - AC-3: the prompt for a waiting pass, for a running pass, for two busy passes, and with the confirmation warning;
    cancelling; under way, and no answer within 15 seconds; a prompt that is out of date; the stopped outcome; a stop
    that came too late.
  - AC-4: a refused request and a failed one.
  - AC-5: who started and stopped each pass shown, the history, the empty state, and an action that could not be
    recorded.
- **Story 4's and story 5's request pins are revised, not deleted.**
  - PS13, PS14 and the browser spec's non-GET log allow exactly this story's requests, and any read route the
    Architecture adds, and nothing else. TF1 stays as it is, so every read still sends GET.
  - PS14's message (`test/tagging-pipeline-panel-source.test.js:759`) and the browser spec's no-confirm message
    (`tests/brainstorm/tagging-pipeline-panel.spec.js:817`) name story 7 for Confirm.
  - B9's pin on how a pass starts (`tests/brainstorm/tagging-pipeline-panel.spec.js:785`) follows the new line.

### Carry-forwards from story 5's review (C5-1 to C5-10)

Placed by the owner on 2026-10-01 (`reviews/tagging-edges/5-real-time-path-switch.md` § "Re-review, round 2",
carry-forwards 1–10; the epic's item 6 holds each one's ask). Who does each:
- **Tester (test plan, test comments):** C5-1, C5-2 and C5-3, in story 5's test plan and suites.
- **Architect (ADR):** C5-7; C5-8's ADR 0005 D6 note; C5-9's re-dating of ADR 0005's round-1 notes (below); and
  C5-4, by choosing between the panel change and rewording ADR 0005 D13's note to match the code. *(Corrected at
  Architecture, 2026-10-02: the six round-1 notes are three in ADR 0005 and three in ADR 0004 (ADR
  `tagging-edges/0006` § Amendments). C5-4 is the panel change, ADR 0006 D20.)*
- **Implementer (copy and docs):** C5-4's panel change, if chosen; C5-5; C5-6 (optional copy); C5-8's BIBLE and
  OPERATIONS halves; and C5-10.
  - C5-9 uses 2026-10-01 (local), the convention review 1's requested change 13 chose for story 5 (a PO proposal,
    below).

## Concepts touched

None directly. The pass it runs and stops writes taggings of
`39998:82b75e474dda005e912bcbb910391c60c2b89cc7faf5d3c30b7c59a324973833:nostr-user-tag` (and this deployment's own
stamp, TA resolved at runtime) into relationships between `39998:<TA>:nostr-user` ends, as in stories 4 and 5.

## Out of scope

- **Confirming held removals from the panel: story 7.** That story also covers:
  - what admins see in its place;
  - who confirmed, and when;
  - ledger row `2026-09-28-confirm-route-joins-finishing-job` for the confirm route.

  If this story's fix for Run also closes the window for the confirm route, the row closes here and story 7 checks it.
- **A force-stop:** declined at story 5's Planning.
- **Who may change schedules,** and the other open routes: the 2026-07-21 intake sweep, as in stories 4 and 5. Adding
  or enabling an interval schedule entry still starts a pass at once. *(Corrected at Architecture, 2026-10-27: settled before this story's
  Architecture.
  - **Schedule writes.** They have been for the owner, admins and direct local calls since 2026-10-10.
  - **Action routes.** Since story 8, none is open unless the route table opens it (`security-auth-exposure` stories 6
    and 8; the intake entry was picked up, and its book closed on 2026-10-11).
  - **Still true.** Adding or enabling an interval entry still starts a pass at once, now only at their hands. AC-5
    records that start as the schedule.)*
- **Scheduled runs that come due while a pass is busy** still line up behind it, as today. Run does not move the
  backstop's next run.
- **The queue dashboard's own controls** (`/admin/queues`): unchanged. A start made there shows as "started another
  way".
- **Stopping other tasks,** or a general stop for the task system.
- **How soon a pass reaches a safe point:** the pass's existing stop checks stand.
- **The 30-minute time-out** still ends a pass without a final report.

## Open questions

None, once the owner ratifies the Product Owner's proposals below by approving this story.

**Decided at story 5's Planning (2026-10-01, the owner; epic item 6):**
- Run is for the owner or an admin, and is refused plainly while a pass is busy. The backstop's future run never
  counts.
- The run-task route is closed for this pass to anyone but the owner or an admin. Scheduled Tasks stays with the
  intake sweep. *(Since 2026-10-10 the route table closes the run-task route and the Scheduled Tasks writes to the
  owner's side for every task (`security-auth-exposure` stories 6 and 8). What remains this story's on that route, for
  this pass, is this Planning's decisions below.)*
- Stop is graceful and never touches the schedule. A stopped pass reads as its own outcome, with who and when.
- Every viewer sees waiting and stopping, and a reload keeps them.
- An admin may stop a pass that is applying the owner's confirmation, after a warning.
- Every start and stop records who and when; the panel shows the latest and a short history.

**Decided at this Planning (2026-10-02, the owner):**
- **The split.** Confirm moves to story 7.
- **Due scheduled runs count.** A scheduled run whose time has come and that is waiting counts as waiting: Run is
  refused, every viewer sees it, and Stop can take it out of line.
- **Direct local calls stay exempt** from the run-task route's who-may check, and are recorded as a local call.
- **The run-task route answers as Run does** for this pass: it refuses while a pass is busy, is never answered as
  lined up when no pass will run, and refuses a request from another site. A refused request records nothing.
- **Evidence** includes an admin stopping a waiting pass on staging (below).

**Proposed by the Product Owner, ratified with this story:**
- Run asks nothing; the prompts are for Stop (here) and Confirm (story 7), as story 4's Planning set.
- A stop acts on every busy pass with no stop asked for when it is confirmed, and is refused if what is busy has
  changed since its prompt opened. A pass that lines up after a stop was asked for is not covered by it, and can be
  stopped in its turn.
- A waiting pass that is stopped leaves no pass report.
- A stop that comes too late is shown as such, and the pass's own outcome stands.
- A waiting pass that gives up after 4 hours is shown as having given up.
- Run is refused plainly when the task queue is unavailable. When the server cannot tell whether a pass is waiting,
  viewers are told so.
- When an action cannot be recorded, a Run is refused, a Stop still takes effect, and a start that cannot be refused
  goes ahead; the last two show as not recorded.
- The line beside Run when the owner's confirmation is pending.
- The history keeps the last 10 actions. "Who" shows as story 5's does (owner or admin plus a shortened key), or as the
  schedule, the owner's confirmation, a local call, or "started another way".
- Only a signed-in owner or admin may read "who". The public status may say that a pass is waiting or a stop was asked
  for, and when.
- The 15-second limit before a request with no answer reads "outcome unknown", as in story 5, for Run and Stop alike.
- C5-9 uses 2026-10-01 (local) for story 5's round-1 notes, the convention review 1's requested change 13 chose, so
  story 5 stays in one convention throughout; the Architect re-dates ADR 0005's six notes. *(Corrected at
  Architecture, 2026-10-02: three of the six are in ADR 0004.)*
- **Evidence:**
  - a browser test on the rebuilt UI;
  - on the local stack, a stop of a waiting pass, with the heavy-task lock held on purpose, and of a running pass;
  - on staging:
    - the owner and an admin each run a pass and see who started it;
    - a second Run while one is busy is refused;
    - a user who is neither owner nor admin is refused at the run-task route for this pass, and gets no "who";
      *(Corrected at Architecture, 2026-10-27: the refusal half has held on staging and production for every task since
      2026-10-10, so it now checks that the gate still holds. The evidence this story adds for that user is the "no
      who" half.)*
    - an admin stops a waiting pass, while other heavy database work holds the shared lock;
  - production gets read-only checks only.

## Linked artifacts

- ADR: `engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md`
- Test plan: (filled in after Test Design phase)
- Review: (filled in after Review phase)
