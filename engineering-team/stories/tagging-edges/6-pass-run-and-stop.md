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

## Evidence

### The gate (Implementation, 2026-10-28; corrected and extended at the review fix round)

Node 22.23.3, full `npm test`, read from the run records (`gate:status`):

| Run | Tree | Backend its live suites measured | Passed | Failed | Skipped | Suites |
|---|---|---|---|---|---|---|
| Before the story `20261028T002652Z-23104-e887` | `cb7fe4f8`, the accepted ADR (a worktree) | started 2026-10-02 | 6,460 | 38 | 170 | 312 |
| After Implementation `20261028T052917Z-3731-46dd` | `ca504c42` | started 2026-10-02 | 6,662 | 38 | 170 | 315 |
| After Amendment 1 `20261028T142811Z-28439-0e14` | `5ee2ba47` | started 2026-10-02 | 6,671 | 38 | 170 | 315 |
| The review's run `20261028T154319Z-13921-dcd1` | `5e0e0fdd` | restarted 14:41:54Z, on `5ee2ba47` | 6,675 | 36 | 168 | 315 |
| After the fix round `20261028T231211Z-47881-872a` | `1d4170c3` | restarted 23:11:49Z, on `1d4170c3` | 6,679 | 36 | 168 | 315 |

- **Which backend the live suites measured.** The first three runs started before the local backend's restart at
  14:41:54Z (`…-e887` at 00:26Z, `…-46dd` at 05:29Z, `…-0e14` at 14:28Z). So their live suites measured the process
  started on 2026-10-02, not this story's server code. The review's run and the fix round's run each followed a restart
  onto their own code, the second with `scripts/dev-refresh.sh --server`. *(Corrected at the review fix round,
  2026-10-28: the section first quoted the three runs with no word about the backend.)*
- **The story's suites pass in full.** The new ones, after the fix round:
  - pass-control, 73 (71 after Amendment 1, plus CT69 and CT70);
  - pass-routes, 40;
  - job-gate, 27.

  Each suite whose counts changed, before → after:
  - runner, 77 → 87;
  - wiring, 74 → 86 (84 after Amendment 1, plus SWR85 and SWR86);
  - state-routes, 55 → 62;
  - view, 82 → 110;
  - fetch, 24 → 31;
  - panel-source, 28 → 38;
  - realtime-engine, 82 → 83.

  Two more were edited with unchanged counts: codes (54) and switch-record (47).
- **Among the first three runs, no other suite changed.** The same 16 suites fail in all three, with the same pass,
  fail and skip counts and the same failing tests. One of them fails for a host reason, not the live stack:
  `router-stream-limit-on-connect`, because macOS's `sed` differs from Linux's (ledger
  `2026-10-09-router-patch-sed-macos`).
- **After the restart, seven other suites changed** (the review's run against the baseline). None is this story's.
  - Three now pass: `information-for-agents`, `list-headers-me-disposition` and
    `list-headers-my-assistant-disposition`. `stamped-composite-avatar` no longer skips 2.
  - Three newly fail: `nip51-list-export-from-pins`, `relationship-primitives-probe` (H2) and `teach-it-what-matters`
    (H6; H7 fails as before). Each failing test expects 404 for an unregistered `/api` route, which the route table's
    default-deny (`151e39fb`) answers 401. The restart was the first time this host's backend ran that code, and the
    story's diff to `routeAccess.js` adds only its own three entries (ledger `2026-10-28-live-tests-expect-404-not-401`).
- **After the fix round** (its run against the review's): only pass-control (71 → 73) and wiring (84 → 86) changed.
  Every other suite has the same verdict, counts and failing tests. `router-stream-limit-on-connect`'s messages differ
  only in their temporary folder names.
- **Two records read dirty (1).** The baseline's, because of its worktree's untracked `node_modules`. The fix round's,
  because one ledger row (`2026-09-20-live-tier-fails-on-stale-stack`) was edited and not yet committed; it is
  committed with this evidence.
- **The browser spec** passes 120 of 121 on Chromium. It ran once at Implementation, against the UI built inside the
  container from the working tree after Amendment 1's tests, and twice more in the review's gate lane, against
  `5e0e0fdd`'s build (`index-CHcumCZ-.js`), with the same result each time. The one failure is B39, red before this
  story (ledger `2026-10-28-relay-subtab-baseline-stale`). The fix round changed no UI source and no browser spec
  (`ui/` and `tests/` are unchanged since `5e0e0fdd`; the fixtures helper the spec shares gained comments only), so the
  spec was not run again. *(Corrected at the review fix round, 2026-10-28: this bullet first said "twice" of the
  Implementer's own run, which ran once.)*

### The local stack (2026-10-28)

The backend was restarted at 14:41:54Z with `scripts/dev-refresh.sh`, running `5ee2ba47`; the UI was rebuilt
(`index-CHcumCZ-.js`). The owner signed in by a scripted challenge, with the key kept in memory.
- **Signed out:**
  - Run, Stop and the record read answered 401 "Sign in as the owner or an admin to do this.", and so did run-task
    for this pass.
  - A host `curl` to run-task is not a local call, and also got 401.
  - The public status carries `control` `{queue: 'ok', busy: [], gaveUp: null}`.
- **A waiting pass, stopped.**
  - **The setup.** The heavy-task lock was held on purpose: a 10-minute `evidence-hold` lease, released after. The
    owner's Run (14:43:13Z) answered 200, lined up `reconcileTaggingEdges-bf168bdd9d74`.
  - **While it waited.** The signed-out status listed it as waiting since 14:43:13.216Z behind `heavy-work`, with no
    who. A second Run answered 409 `pass-busy`, and so did a direct local call to run-task, with its `message`.
  - **The Stop** (14:43:23Z) answered 200 `taken-out-of-line`. The next status showed nothing busy.
  - **The semaphore's events.** The wait ended `abandoned` at 14:43:24.388Z, 11 s after it began. No process started,
    `report.json`'s latest was unchanged, and the job left the queue.
  - **The record** gained the owner's start and stop, with `skip: true`. `control/` is 0700 and `record.json` 0600.
- **A running pass, stopped.**
  - **The setup.** The owner's Run lined up `reconcileTaggingEdges-4362bb686e54`. A watcher sent `SIGSTOP` when its
    first record appeared (run `20261028T144351Z-e23b30c3`, `job.id` the key, phases `identities`, `schema`).
  - **The Stop** answered 200 `asked-to-stop`. The pass's `/proc` status then showed SIGTERM pending (`ShdPnd`,
    signal 15) on its own pid. That mask shows a signal is pending, not how many were sent. That only one was sent
    rests on the controller, which calls `kill` once per running target, and on the tests that pin one SIGTERM (CT37,
    CT41).
  - **While the pass was still stopped.**
    - The status listed it as running, with `stopAskedAt` 14:44:00.491Z.
    - A Run was refused `pass-busy`.
  - **After `SIGCONT`,** the pass ended at 14:44:07.700Z:
    - `outcome: 'stopped'`, `reasonCode: 'requested'`, `failure: null`, at the safe point before the claim;
    - `TASK_END` reads `outcome: 'stopped'`, with no `TASK_ERROR`;
    - the launcher's exit code was 0, and the lease was released.
  - **Then** nothing was busy, and the record held the owner's start and stop.
- **A direct local call** (`docker exec tapestry curl` to `127.0.0.1:7778`) with nothing busy answered 200 "A
  gap-filling pass was lined up.". The record shows its start as `{kind: 'local'}`, and the pass ran to `done`.
- **No who reached a signed-out reader.** Signed-out reads of the status, the held list and the Task Explorer's data
  for this task carry neither the owner's key nor any recorded who. Neither do `report.json`, the task events and the
  structured log.
  - **The backend's console log.** It names the owner's key only in lines written by code older than this story:
    - the config reader's "Found BRAINSTORM_OWNER_PUBKEY" and "Found BRAINSTORM_ADMIN_PUBKEYS=" lines (the local
      admin list holds the owner's key);
    - the sign-in route's own lines;
    - the profile-metadata lines (`src/api/export/profiles/queries/kind0.js`).

    The story's diff adds no `console.*` call. That key is already public at `/api/about-this-instance`.
    *(Corrected at the review fix round, 2026-10-28: the list named only the owner-key line and the sign-in route.)*
- **Left for staging** (the evidence plan): the owner's and an admin's Runs with who shown, an admin stopping a waiting
  pass while other heavy work holds the lock, and a stranger's "no who".

### The local stack, at the fix round (2026-10-28)

The backend was restarted at 23:11:49Z with `scripts/dev-refresh.sh --server`, running `1d4170c3`. The owner signed in
as before.
- **A pass added the way the queue dashboard adds one, stopped (Blocking 1).**
  - **The setup.** A script in the container added a pass job straight to the queue with BullMQ, as the dashboard
    does, with the id `reconcileTaggingEdges@x` and the data the app's own adds use (23:25:35Z). It sent `SIGSTOP` when
    the pass's first record named that id (run `20261028T232535Z-17e8e4b6`).
  - **While it was held,** the status listed it running, its key and `jobId` both `reconcileTaggingEdges@x`, its start
    recorded.
  - **The owner's Stop** answered 200 `asked-to-stop`, `recorded: true`. SIGTERM was then pending on the pass's own pid
    (`ShdPnd`, signal 15), and the status showed `stopAskedAt` 23:25:41.983Z. Before the fix, the same Stop answered
    `too-late` and sent nothing (the review's probe; CT69).
  - **After `SIGCONT`,** the pass ended at 23:25:51.359Z with `outcome: 'stopped'`, `reasonCode: 'requested'`,
    `failure: null`, at the safe point after `schema`. `TASK_END` reads `outcome: 'stopped'`, and the lease was
    released.
  - **The record's entry** for the key carries `jobId: 'reconcileTaggingEdges@x'`, the start as "another way", the
    owner's stop with the run's `runId`, and `noRerun: true`. Then nothing was busy.

## Deviations

These are small judgement calls made at Implementation (2026-10-28), too small for an ADR amendment.

- **The controller** (`src/pipeline/tagging-edges/control/`).
  - **Answers.** `lineUp` and `stop` always resolve `{status, body}` and never reject. An unexpected throw inside a
    step answers 500 `{code: 'error', cause}`, with `cause` allow-listed. In confirm mode it also answers
    `enqueued: false`.
  - **A failed add.** An add that times out answers 503 `QUEUE_UNAVAILABLE`; one that is refused answers 500
    `{code: 'error', cause}`. D6 allows either. The add gets a fresh `stepMs` (2000 ms) of its own.
  - **The job data's `timeoutMs`** comes from a default dep, `taskTimeoutMs()`, which reads the registry the way
    `queue/index.js` does. It is not in § Seams' deps list, so the tests use the default.
  - **No flag check.** The controller never reads the task-queue flag. The queue-off refusal is the handlers' (PX6,
    PX6b).
  - **`endedKeys` expire by `now()`** when they are read and on each `gate.ended`, with no timer. That is the same
    10 s in production.
  - **The status cache** measures its 1000 ms in real time. A status snapshot still in flight is shared only by
    readers of the same generation. A `fresh: true` snapshot never reads or writes the cache.
  - **The record is re-read on every use** while its last read was unreadable or damaged, not only before a write.
    Nothing is written while it gives a read error. A file that parses but is not `{version: 1, passes, history}` is
    treated as damaged, and renamed aside before a fresh write.
  - **Two extra checks.** The pre-signal check also requires `latest.runId` to equal the target's `runId` when that is
    known. Any throw from `kill` reads as too late.
  - **When a read throws.**
    - A `listClaimed` throw gives a running item's verdict `'cannot-tell'`.
    - A `readConfirmation` throw counts as pending.
    - A `queueHealth` throw counts as `'not-ready'`.
  - **Who is normalised before it is recorded:** `{kind}`, plus an 8-character `key` for the owner or an admin. A
    full pubkey cannot reach the record.
  - **A `run:` stop target.** Its `noRerun` goes only under the report's job id, and only when that id is not the
    legacy one and matches D10's pattern. The `run:` entry itself keeps `noRerun: false`.
- **The routes** (`src/api/tagging-edges/pass.js`, `index.js`, `runTask.js`).
  - **Sentences beside codes.** Run's and Stop's refusals carry an `error` sentence beside the fixed `code`, as
    story 5's refusals do.
  - **The delegate's own `message` texts** are this story's wording for 503, 500 and its 401 and 403s. D7 fixes only
    the 200 and 409 texts, and those are used as written.
  - **When the status's snapshot fails.** If the snapshot rejects, or answers null or undefined, the status still
    serves the report. Its `control` is then `{queue: 'read-failed', busy: [], gaveUp: null}`, never a 500. Any other
    answer is not checked: its `queue`, `items` and `gaveUp` become `control`'s `queue`, `busy` and `gaveUp`, so a
    string, number, boolean or `{}` gives `control: {}`. The real controller always answers `{queue, items, gaveUp}`.
    *(Corrected at the review fix round, 2026-10-28: this read "answers something that is not an object", which
    `controlOf` never checked.)*
  - **`index.js`'s `defaultDeps`** loses `isQueueAvailable`, `runViaQueueAsync` and `taskTimeoutMs`. Nothing in the
    file calls them after D8.
  - **The confirm route** copies `jobId` only when it is a string. It adds `joined: true` only when the controller says
    so.
  - **Stop's body.** An empty key is refused 400. Extra members on the body or on a target are ignored, and only
    `{key, state}` reaches the controller.
  - **The record GET.** A `readRecord` throw answers 200 `{state: 'unreadable', readError}`, as `realtime.js`'s
    `readOrError` maps one (PX26 allows this or a 500).
  - **A malformed controller answer** becomes 500 `{code: 'error'}`, so every handler still resolves.
  - **The registrations** sit in their own block in `src/api/index.js`, after the drift route. `pass.js` also exports
    its pure helpers `validateStop` and `recordView`.
- **The task queue** (`src/manage/taskQueue/queue/`).
  - **The HDEL after an abandoned win is best effort**, as `release()` is. A Redis error at that moment completes the
    job as skipped instead of failing it.
  - **`shouldAbandon` is used only when it is a function.** The `abandoned` wait-end is emitted only after a
    wait-begin, at both abandon points.
  - **`initTaskQueue` calls `gateFor`** once for every task as its worker is built. Only the `resourceClass` branch uses
    the gate.
  - **The gated callback is the first arm** of the callback choice, so today's tagged and untagged callbacks are
    unchanged byte for byte.
- **The pass** (`reconcileTaggingEdges.js`).
  - **An unset job id.** `BRAINSTORM_TASK_JOB_ID` is checked as a string before the pattern: `RegExp.test(undefined)`
    would match the text `'undefined'`.
  - **On the first-save failure,** the handlers are removed just before the return, after its events.
  - **`job` is the pessimistic record's last member.** An injected `job` dep is used as given.
- **The panel** (`taggingPipelineView.js`, `PassControls.jsx`, `PassSection.jsx`).
  - **The history.** `passWho` also returns the history (the last 10, newest first) and its empty-state sentence. This
    keeps the who words in one table.
  - **A new line shape, `{text, at, end}`,** carries D16's and D18's sentences, which put the time mid-sentence.
  - **busyView.** Its items carry D12's members plus `line` and `stopLine`. The gave-up line is the panel's, from
    `control.gaveUp`.
  - **A record that cannot be read.** A record answer of `unreadable` or `damaged` reads as failed, with its own
    sentence, rather than every run reading "start not recorded".
  - **Tones.**
    - A Stop is `ok`; `neutral` when every target came too late; `warn` when it was not recorded.
    - For the other outcomes, the 409 refusals (`pass-busy`, `prompt-out-of-date`, `pass-not-reachable`) and unknown
      are `warn`, and nothing-to-stop is `neutral`. The 401 and 403 refusals, queue-unavailable, record-unavailable and
      failed are `bad`, as in story 5. *(Corrected at the review fix round, 2026-10-28: this read "the refusals and
      unknown are `warn` … the failures are `bad`", which `PASS_ACTION_TONE` never did.)*
  - **Outcomes show the allow-listed `cause`** beside story 5's status and code.
  - **`passReason.requested`** also says that a claimed confirmation is used up (SR69).
  - **C5-6 was taken.** The `no-status` premise names a fault in the driver itself beside another library. No test
    pinned the old text.
  - **Each Stop prompt block opens with a timed subject line,** so two blocks of the same state can be told apart.
  - **While a stop is under way,** the prompt's Cancel is disabled as well as its stop button. A Cancel then would only
    close the prompt, and would suggest the stop was called off.
  - **What the open prompt replaces.** It takes the Stop button's place; Run a pass now stays.
  - **It closes by itself** only on a read that knows nothing is busy. *(Corrected at the review fix round,
    2026-10-28: this read "when the busy list read is empty, whether or not the queue state is known", which no
    committed code did. See the later bullet "The Stop prompt closes by itself" and ADR Amendment 1 § C, D17.)*
  - **A busy item's stop line** comes from `passWho` when it has one, else from `busyView`'s who-free `stopLine`.
  - **A failed record read** shows `ReadFailed` with Retry. A record answer that is unreadable or damaged shows its
    sentence with no Retry; the 5 s poll re-reads it.
  - **Who in the passes table.** `EarlierPasses` gains a Who column after Outcome. `LatestPass` shows the same pair
    after its times.
  - **Where the parts live.** `TimedLine` and `WhoLines` are named exports of `PassControls.jsx`, as story 5's
    `SwitchRecord` is of `PathSwitch.jsx`.
  - **This story's own copy.**
    - The prompt's heading: "Stop the busy pass?" or "…passes?".
    - The gave-up line.
    - The history heading: "Recent actions, newest first.", ended with a full stop so that B110's sentence check reads
      it apart from the first row.
- **The ADR notes** (ADRs 0002–0005, the Architect's).
  - **Their form** is `*(Amended by `tagging-edges/0006`, 2026-10-28: …)*`, copying ADR 0002's existing style.
  - **References by name, not number.** Notes refer to other notes by heading, because line numbers shift.
  - **Small wording fixes.**
    - "Since story 8" names `security-auth-exposure`.
    - "This ADR's part" reads "ADR 0006's part".
    - C5-8's "no `Origin` passes" reads "a request with no `Origin` passes".
  - **Placement.** Notes inside a code fence or a table row sit after the fence or inside the cell.
- **After the Implementer's own check against the ADR** (2026-10-28; four read-only checks, each finding confirmed or
  rejected before any change).
  - **The take-back of a failed add** (D6 step 3, D8) writes back the record as it was just before the start's own
    write. Removing only the new entry and its line would lose an older line or entry that the start's cap or pruning
    had pushed out.
  - **Pruning (D11)** also keeps an entry whose `stop.runId` is a run in `report.json`. Otherwise a stopped hand run's
    `run:<runId>` entry, which has no `jobId`, was dropped while its run was still shown.
  - **`stopAskedAt` (D5).** A key's in-memory stop mark counts only for its own execution:
    - a running item through its `runId`, or a mark with no `runId`;
    - a starting item launched no later than the stop;
    - never a waiting item.

    A re-run of the same job id in the same process is therefore not shown as already stopped.
  - **Record entries** are created and read as own properties, so a job key such as `__proto__` is an ordinary entry.
  - **`passWho` (D16).** A busy running item with a run reads as live from its own state, not from
    `status.running`, so a reused 1 s status snapshot cannot say "running" and "stopped on request" together.
  - **The Stop prompt closes by itself** only on a read that knows nothing is busy. A read that cannot tell leaves it
    open.
  - **`PassControls` carries a `key`** in both branches, so the empty-to-ready switch does not remount it.
  - **Copy.** The changed sentences are:
    - `passReason.requested` no longer says the owner or an admin asked (R6: any stop signal);
    - "asked to stop" is in the past tense;
    - the plural too-late sentence no longer says "some";
    - Run's queue-unavailable sentence names the task queue being switched off;
    - the empty-state line reads as three ways a pass starts.
- **Amendment 1 (2026-10-28).**
  - **The predicate is copied as written,** so `pass.js`'s `MAX_TARGETS` is renamed `STOP_TARGETS_MAX` rather than kept
    beside it.
  - **The 400's sentence** reads "1 to 50 distinct keys, each a string of 1 to 256 characters (UTF-16 code units) with
    no control character and no U+2028 or U+2029".
  - **OPERATIONS §12.8's R9 bullet** also names the in-app case, more than 50 enabled Scheduled Tasks entries (§ B
    (b)), and the doubly listed pass's `pass-not-reachable` (§ B (c)), since both have the same way out.
- **The fix round (review round 1, 2026-10-28).**
  - **A report's job id is compared with the item's own.** `waitForRun` and `signal` now compare the report's `job.id`
    with the busy item's own `jobId` (the queue job's id, or for a live pass the report's), and the stop entry records
    that `jobId`. None of them uses a value derived from the key, and `jobIdOf`, which had no other caller, is removed.
    - **The snapshot too.** Its finishing-window check, which reads a launched job's own run as ended, compares the
      report's `job.id` with the id of the job it is classifying, not with the id stored under the job's key. So the
      amended D2 rule holds there as well, for R9 (d)'s two jobs under one key included.
    - **Why.** `jobIdOf` mapped every key that starts `reconcileTaggingEdges@` to the legacy id. So a Stop of a running
      pass whose queue-dashboard id had that form sent no signal and answered too late, and a Stop of a starting one
      answered `pass-not-reachable` (Blocking 1; CT69).
    - **What stays.** `keyOf`'s key scheme and the `run:` rule are unchanged. The one pair the key scheme still cannot
      tell apart is the Architect's residual R9 (d).
  - **A time outside a JavaScript Date's range.** `toIso` returns null when `new Date(ms)` is invalid, so neither the
    status snapshot nor the start's record throws on such a time.
    - A busy item with such a time is served with `since: null`.
    - The stop entry leaves out its schedule start, and the status's `gaveUp.at` is null rather than a throw.
    - **Why.** One busy job with such a time, in its id or its timestamp, could otherwise make the status say it cannot
      tell what is waiting, make Run, Stop and the confirm route answer 500, and fail the job at pickup (Requested 5;
      CT70).
  - **The job id in a task's environment.** `processor.js` sets `BRAINSTORM_TASK_JOB_ID` only when the job's id has no
    NUL character and is at most 200 characters long (UTF-16 code units, `String.prototype.length`). Otherwise it
    leaves the variable out: the task launches as it did before this story, and the pass records `job: null`, as for
    any id outside D10's pattern.
    - **Why no NUL.** Node refuses an environment value that holds NUL, so a job of any task with such an id would fail
      at launch, where before this story it ran (Requested 6; SWR85).
    - **Why 200.** Linux refuses any one environment string of 128 KiB or more (`E2BIG`), and BullMQ accepts an id that
      long, so a job of any task with such an id would also fail at launch. The bound is D10's pattern bound, which the
      pass already applies before it records an id. The pass is the variable's only reader, so no reader loses
      anything, and the corner is closed (SWR86).

## Linked artifacts

- ADR: `engineering-team/decisions/tagging-edges/0006-pass-run-and-stop.md`
- Test plan: `engineering-team/stories/tagging-edges/6-pass-run-and-stop.test-plan.md`
- Review: `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md`
