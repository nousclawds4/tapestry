# A promotion of all of staging shipped a story whose file said to hold main until its staging evidence existed

**Id:** 2026-10-02-promotion-outruns-pre-main-evidence
**Type:** meta
**Opened:** 2026-10-02 (tagging-edges #6 Planning; seen while correcting the epic and handoff for story 5)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The hold was written down.** At 15:31:54Z on 2026-10-02, story 5's file on staging
  (`engineering-team/stories/tagging-edges/5-real-time-path-switch.md` at `811c7666`, which PR #809 merged to main as
  `09ec35b0`) had a section titled "After the merge to staging (not yet run)". It said a Staging section holding the
  evidence "must exist here before staging is promoted to main".
- **The promotion did not read it.** At that moment, another session's promotion of all of staging merged story 5
  (PR #805) to main (PR #809). Its deploy, run `37027633805`, reached production by 15:53:22Z. The promotion's body
  listed #805 as "another session's work" whose review had passed. It did not mention the open evidence.
- **The evidence came later.** The owner's half of the evidence was done at 23:14Z, and the record merged to staging
  at 23:21:59Z (PR #813).
- **No harm, by luck.** Production was checked read-only afterwards and was healthy, and the evidence then passed.
  Had it failed, production would have been carrying a story whose staging check had found a fault.

**Why it happens.** `/cycle-prod` takes the bundle from the commit list `git log origin/main..origin/staging`
(`.claude/skills/cycle-prod/SKILL.md`, step 1) and states it in the PR body. A story's own "hold main until …" lives
only in its prose, and its Status already reads `Done` at the
review's PASS, before any staging evidence. Nothing a promoting session reads says "this one is not ready for main".
The cycle-staging skill's "Promote #<PR#> to main?" pause binds only the session that shipped it.

**Fix shape.** Pick one, at triage:
- **A label.** A `hold-main` label on the staging PR while its pre-main evidence is open. `/cycle-prod` lists the
  bundled PRs' labels, and stops and asks if any carries it. The shipping session removes it when the evidence is
  recorded.
- **A marker in the story.** A fixed line, such as `**Main:** held until <evidence>`, that `/cycle-prod` greps for in
  the stories its bundled PRs touch.
- **Either way,** `/cycle-prod`'s PR body names each bundled story's evidence state.

**Pointer:** PR #809's body; story 5 at `811c7666`, § Evidence; `.claude/skills/cycle-prod/SKILL.md`;
`docs/TAGGING_EDGES_HANDOFF.md` § 0, "Story 5, shipped". Related, not the same: `2026-09-20-promotion-bundle-body-goes-stale`
(a promotion's bundle description goes stale between open and merge).
