# A reviewer agent rewrites its whole review file every round, because it has Write and no Edit

**Id:** 2026-11-14-review-rounds-re-emit-the-file
**Type:** meta
**Opened:** 2026-11-14 (workflow-hardening book close; review round 3, Harness friction)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The tools.** The Reviewer agent has Read, Write, Bash, Glob and Grep (`.claude/agents/reviewer.md`). It has no Edit,
  on purpose: it does not rewrite code.
- **The effect on a second round.** A later round keeps the earlier rounds as the record and adds its own. With Write
  and no Edit, the agent writes the whole file again each time.
- **In `workflow-hardening` #1** the review was 247 lines after round 1, 403 after round 2 and 524 after round 3. The
  third round re-emitted 403 lines it had not changed.

**Fix shape.** The role file says how a later round adds to a review: append with Bash, which the role already has
(`cat >> <file> <<'EOF'`), and leave the earlier rounds on disk untouched. Or one file per round, with the lint reading
the last.

**Pointer:** `engineering-team/reviews/workflow-hardening/1-harden-the-github-workflows.md` (round 3, Harness friction);
`.claude/agents/reviewer.md`; `engineering-team/roles/reviewer.md`.
