# main's H^2_0 baseline says only the Tapestry Lead merges main over ngit, but promotions now merge on GitHub

**Id:** 2026-10-29-h2-0-baseline-predates-github-flow
**Type:** meta
**Opened:** 2026-10-29 (tagging-edges story 6's promotion, PR nousclawds4/tapestry#11)
**Status:** OPEN
**Done:** —

**What was seen.** `docs/harness/H2_0-baseline.md` (H^2_0, approved 2026-10-21) is on `main` only; `staging` has no
`docs/harness/`. It records these rules:
- the Grawk Tapestry Lead alone merges to `main`, over ngit, with Nous as the backup merger;
- GitHub is off limits to agents, and `.github/workflows` are retired;
- each production deploy is manual, "each with David's OK";
- before every merge to `staging` or `main`, the Lead runs `npm test` by hand and records the result in the merge
  commit.

The rescue merge `73bfa5ca` (2026-10-23) adds that GitHub is "a deploy-only mirror", pushed fast-forward only from
ngit. Its message also says "An H^2_0 amendment is still to be written." No branch on GitHub, in nousclawds4/tapestry
or the old nous-clawds4 repo, carries that amendment. ngit, which the message names as the source of truth, was not
checked.

**What happens instead, since 2026-10-27.**
- PRs nousclawds4/tapestry#1 to #7 were merged into `staging` on GitHub.
- Actions run the Test and deploy workflows.
- `/cycle-staging` and `/cycle-prod` merge with `gh pr merge`.
- On 2026-10-29, promotion PR nousclawds4/tapestry#11 was merged into `main` on GitHub (`62b1ad7a`), by a session as
  `virgil-clawds4`. The owner chose an option in chat confirming "that GitHub PRs into main are now allowed and that
  this counts as the OK for this production deploy". Here the owner is David (straycat, `e5272de9`), whom H^2_0 calls
  the project authority; H^2_0 names Nous as the repo's owner. `npm test` was not run by hand; the `stack-free` Test
  ran on the PR.
- `scripts/harness-def-paths.txt` on `main` still says the workflows are retired and that "no workflow runs".

**Why it matters.** The rule and the practice disagree, and nothing reconciles them:
- A session that reads H^2_0 alone would refuse to merge.
- A session that reads only the skills would merge on GitHub once the user says yes, without raising that H^2_0 lets
  only the Lead merge `main`, over ngit.
- A session that orients from `staging` never sees H^2_0 at all.

The owner's answer allows GitHub PRs into `main`, but H^2_0 still says otherwise. Until it is amended, raise it before
each promotion, as for nousclawds4/tapestry#11. Each promotion needs the owner's yes under `/cycle-prod` anyway.

**Fix shape.**
1. The owner confirms whether the 2026-10-29 answer replaces H^2_0's merge rule (ngit, the Lead only).
2. Amend H^2_0 or retire it. By its own rule, an L0/L1 change needs David's OK in chat before it merges.
3. Fix the "retired" comment in `scripts/harness-def-paths.txt`.
4. Bring the result into `staging`, so both branches carry the same rule.

**Pointer:** `docs/harness/H2_0-baseline.md` (on `main`); the message of commit `73bfa5ca`; PR nousclawds4/tapestry#11
and its merge commit `8534b050`; `engineering-team/stories/tagging-edges/6-pass-run-and-stop.md` § Evidence,
"Production".
