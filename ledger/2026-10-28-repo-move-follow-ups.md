# After the move to nousclawds4/tapestry: the new repo has no branch protection, the old one can still deploy, and public pointers name the old repo

**Id:** 2026-10-28-repo-move-follow-ups
**Type:** ops
**Opened:** 2026-10-28 (the review of `chore/skills-repo-nousclawds4`, the deploy skills' repo fix)
**Status:** OPEN
**Done:** —

**What was seen.** Since the move of 2026-10-23, the droplets are meant to follow `github.com/nousclawds4/tapestry`. The
old `github.com/nous-clawds4/tapestry` is kept as a mirror, and the owner wants the two in sync. The skills fix repointed
every `gh` command. These items remain:

1. **The new repo has no rulesets** (read 2026-10-28; the old repo has both).
   - Nothing on `main` or `staging` restricts deletions, requires a PR, or requires the `stack-free` and
     `main-source-guard` checks.
   - So `/cycle-prod`'s stop on a `BLOCKED` merge state (`.claude/skills/cycle-prod/SKILL.md`, error handling) never
     fires, and nor does the wait-for-`CLEAN` habit (OPEN.md row 209). A merge seconds after a promotion PR opens would
     go through.
   - OPERATIONS §4, §9.2 and §15 still describe the old repo's protections.
   - **Owner action:** recreate the rulesets on the new repo, then re-check OPEN.md row 14.
2. **The old repo can still deploy.** All its workflows are active, and it still holds the droplets' deploy secrets
   (names read; not whether the keys still log in). It also holds other secrets that no longer belong on a mirror.
   - Until that changes, its deploy branches must not be pushed there (`/cycle-staging`, OPERATIONS §9.1).
   - Its `main` and `staging` stay behind as a result: 8 and 9 commits on 2026-10-28.
   - **Owner action:** disable the old repo's Actions, or at least its deploy workflows, and remove its secrets. Then
     mirror its deploy branches.
3. **Public pointers still name the old repo.** They are content, not targeting, so the skills fix left them:
   - `README.md` and `docs/QUICKSTART.md` clone URLs;
   - `SECURITY.md`'s advisory link and repository heading;
   - `docs/information-for-agents.md`;
   - `src/api/openapi.yaml`'s info URL;
   - `src/utils/siteTrust.js`, whose served text `test/llms-txt.test.js:60-69` pins, so the two change together;
   - `ui/src/pages/developers/Hub.jsx:54` and `OpenRanking.jsx:162`;
   - `docs/INTEGRATION_GUIDE_event-tagging-for-external-clients.md:35,74,82`.

   The CLIs stay under `nous-clawds4` (BIBLE §3).

**Pointer:** `.claude/skills/cycle-staging/SKILL.md` ("The old repo"); OPERATIONS §9.1;
`engineering-team/reviews/harness-self-improvement/skills-repo-nousclawds4-2026-10-28.md`.
