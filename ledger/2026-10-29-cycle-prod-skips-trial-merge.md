# `/cycle-prod` reads what staging has that main lacks, but not the reverse, so a diverged main shows up only as a conflicted PR

**Id:** 2026-10-29-cycle-prod-skips-trial-merge
**Type:** meta
**Opened:** 2026-10-29 (tagging-edges story 6's promotion, PR nousclawds4/tapestry#11)
**Status:** OPEN
**Done:** —

**What was seen.** Step 1 of `.claude/skills/cycle-prod/SKILL.md` reads the bundle with
`git log --oneline origin/main..origin/staging`, then opens a `staging → main` PR. It never looks the other way.

On 2026-10-29, `main` had 59 commits that `staging` lacked, brought in by:
- the old repo's twelve promotion merges of 2026-10-11 to 10-14 (nous-clawds4/tapestry#850 to #865, seven of them from
  `promote/*` branches);
- the two H^2_0 merges of 2026-10-21.

`staging` already had the promotions' content, some of it only through the rescue merge `73bfa5ca`. The H^2_0 changes
were on `main` only: the new `docs/harness/H2_0-baseline.md` and added lines in three files `staging` also has (198
lines in all). Even so, `git merge-tree --write-tree origin/main origin/staging` conflicted in 8 markdown record files.
A `staging → main` PR would have been unmergeable on GitHub.

The session found this only because it ran the trial merge by hand before opening the PR. The resolution went into a
`promote/tagging-edges-6` branch (merge `8534b050`; PR nousclawds4/tapestry#11).

**The same skill also assumes rulesets.** The new repo has none (OPEN.md row `2026-10-28-repo-move-follow-ups`). While
the promotion PR's Test ran, its merge state read `UNSTABLE`, not `BLOCKED`, so the skill's "BLOCKED" stop could not
have fired. The merge waited for `CLEAN` only because the session waited.

**Fix shape.** Before step 2:
1. Count `git rev-list --count origin/staging..origin/main`.
2. Run `git merge-tree --write-tree origin/main origin/staging`.
3. On a conflict, stop and show it. The way out is a `promote/*` branch off `main` with the resolution committed, or a
   sync of `main` into `staging` first.

Also say in the skill that the merge waits for `CLEAN`, whatever the rulesets do.

The same check for feature branches against `staging` is OPEN.md row
`2026-09-22-parallel-books-no-shared-line-recheck`.

**Pointer:** `.claude/skills/cycle-prod/SKILL.md` steps 1–3 and "Error handling"; PR nousclawds4/tapestry#11; merge
`8534b050`'s message (the file-by-file resolution).
