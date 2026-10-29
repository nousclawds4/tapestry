# Review: the deploy skills target `nousclawds4/tapestry`, and warn about the old repo

**Reviewer:** Claude (acting as Reviewer)
**Date:** 2026-10-28 (UTC, from `date -u`; the review ran from about 02:05Z to 02:25Z. The commits are stamped
22:06 on 2026-10-27 in the author's -0400 zone, the same instant on 2026-10-28 in UTC.)
**Diff:** `git diff origin/staging...HEAD` on branch `chore/skills-repo-nousclawds4`: two commits on `origin/staging`
`52bc03b6`. They are `c90bd889` (eight files: `.claude/skills/{cycle-staging,cycle-prod,cycle-full,direct-feature}/SKILL.md`,
`engineering-team/roles/director.md`, `scripts/whats-open.sh`, `OPERATIONS.md`, `engineering-team/CHANGELOG.md`)
and `983d94f0` (the `OPERATIONS.md` Last-updated header). The diff has 37 insertions and 22 deletions.
**File:** not numbered. This is the doc / harness lane, and there is no story to match (`workflows/0-intake.md` §3).
**Lane:** fast-tracked docs/harness change (Implementer + Reviewer, Standard strictness). There is no story, ADR or
test plan. The intent anchor is the owner's statement of 2026-10-27, as relayed in the brief: the four droplets deploy
from `github.com/nousclawds4/tapestry` since the move of 2026-10-23, the old `nous-clawds4/tapestry` is kept as a
mirror, and the two should stay in sync.

This reviewer wrote this one file and nothing else in the repo. There was no `git add`, no commit, no push and no
branch switch. Side effects: one `git fetch -q origin staging` (no ref moved; `HEAD..origin/staging` is empty). The
GitHub queries were all reads (`gh run list`, `gh pr list`, `gh secret list` (names only), `gh api` GETs of repo
settings, rules, rulesets and workflows) against both repos. Nothing mutating was sent to any host. Scratch files
live under the session scratchpad.

**Short version.** Every `gh` command and repo slug in the files the brief names now points at `nousclawds4/tapestry`.
The deploy-branch list in the warning matches the push triggers in `.github/workflows/*.yml`. No historical statement
was rewritten. The lint is clean (exit 0), the CHANGELOG row has the table's shape, and the eight suites that read
the changed files pass. **Two things block.**

1. The warning's sentence "It is not wired to the droplets" is contradicted by the old repo's own configuration, and
   it undercuts the reason the warning gives in its own next line.
2. Two open OPEN.md rows still tell a session to run `gh` against the old repo. One of them would send a ruleset
   check to the repo that still has the rulesets, while the repo that now deploys has none.

Separately, and for the owner rather than this diff: the new repo carries none of the branch rules OPERATIONS §4 and
§15 describe.

## Quality gates (run by reviewer, not trusted)

- [x] `bash scripts/harness-lint.sh` in the worktree, gated on `$?`: **exit 0**, last line `harness-lint: clean (0 violations)`.
  - **L10:** the latest harness-definition commit is `c90bd889`, and it touches `engineering-team/CHANGELOG.md`.
    `983d94f0` touches only `OPERATIONS.md`, which is not in `scripts/harness-def-paths.txt`.
  - **L9:** `OPERATIONS.md` says `2026-10-28`. Its last git change (`%ad`, short) is 2026-10-27 local, so the header
    doesn't lag. `2026-10-28` is the UTC day, which is the convention the ledger's ids use (OPEN.md "An id is…").
  - **Budgets:** clean. `CLAUDE.md` and `AGENTS.md` are untouched.
- [ ] `npm test`: **not run, by the brief's instruction** (docs/harness change). There is no `npm run gate:status`
  line to quote. Instead, each suite that reads a changed file, or pins a repo slug, was run on its own through its
  `run()` export with Node v22.23.3 (the scratchpad copy). All returned `fail: 0`:

  | Suite | Reads | Result |
  |---|---|---|
  | `safe-to-merge-check` | the three cycle skills (C4–C6: `gh pr create` before `gh pr merge`, no 45/60) | 16 pass, 0 fail |
  | `operational-direction` | `roles/director.md`, `direct-feature/SKILL.md` | 86 pass, 0 fail |
  | `ci-test-job` | `OPERATIONS.md` (D4 Last-updated) | 14 pass, 0 fail |
  | `harness-lint` | `roles/director.md`, lint fixtures | 85 pass, 0 fail |
  | `gate-result-record` | `roles/director.md`, `direct-feature/SKILL.md` | 34 pass, 0 fail |
  | `rollup-scanners` | `scripts/whats-open.sh` | 33 pass, 0 fail |
  | `session-start` | the digest | 32 pass, 0 fail |
  | `llms-txt` | `src/utils/siteTrust.js` (pins the old slug; see below) | 27 pass, 0 fail |

- [ ] `npm run test:playwright`: not applicable (no UI).
- [ ] _Lint, typecheck and build are not configured, so they were skipped._

## Claims adherence (docs-lane variant)

| # | Claim (where) | Evidence | Holds? |
|---|---|---|---|
| 1 | `origin` → `nousclawds4/tapestry`, the deploy target since 2026-10-23 (`cycle-staging` :25, OPERATIONS :312, :316) | `git remote -v`: `origin` = `nousclawds4/tapestry.git`. The new repo was created 2026-10-23T02:44Z, and its deploy secrets were all set on 2026-10-23. Its `Deploy to Staging` runs succeeded on 2026-10-27. That the droplets' own `origin` was rewired rests on the owner's statement; no droplet was inspected. | Yes |
| 2 | Until 2026-10-23 the target was `nous-clawds4/tapestry` (`cycle-staging` :30) | The old repo's last deploy runs are 2026-10-14. Its `main` and `staging` stop at `b764663d` and `4b6326d1` (2026-10-14). | Yes |
| 3 | Some checkouts carry it as a second remote, `nous-clawds4` (`cycle-staging` :31, OPERATIONS :315) | This checkout: remotes `nous-clawds4` and `origin`, with no `upstream`. | Yes |
| 4 | "It is not wired to the droplets" (`cycle-staging` :31) | The old repo's deploy workflows are all `active` (`gh api …/actions/workflows`). Its repository secrets still carry the deploy configuration those workflows read; the names were checked, values aren't readable. Each deploy job SSHes into the droplet and runs `git pull origin <branch>` plus `docker compose up -d --build`. Whether the old credentials still authenticate is unverified. | **No, see B1** |
| 5 | Its GitHub Actions still run (`cycle-staging` :31, OPERATIONS :317) | Not disabled or archived. All eight workflows are `active`. Its last run was `Test` on 2026-10-19; nothing has been pushed there since the move to start one. | Yes (owner-read 2026-10-27, consistent) |
| 6 | Deploy workflows fire on pushes to `staging`, `main`, `feat/tags`, `feature-magic-carpet` (`cycle-staging` :31–32, OPERATIONS :317–318, CHANGELOG :103) | The `on:` blocks in this branch's `.github/workflows/`: deploy-staging `[staging]`, deploy-tapestry `[main]`, deploy-tags `[feat/tags]`, deploy-magic-carpet `[feature-magic-carpet]`. test and guard fire only on `pull_request` / `pull_request_target`. No `workflow_dispatch` or `schedule`. | Yes, as asked. Across other branches' own trees the set is wider, see N2 |
| 7 | A push there can start an out-of-band deploy that skips the safe-to-merge check (`cycle-staging` :33; CHANGELOG :103 "could start") | Follows from #4's evidence. The run would rebuild and restart the droplet with whatever the droplet's own `origin` holds, with no `scripts/check-safe-to-merge.sh` on the path. | Yes ("can" is the right strength) |
| 8 | Feature branches may be mirrored there (`cycle-staging` :34, OPERATIONS :318) | No workflow in any branch's tree fires on a push to an ordinary feature-branch name. The exceptions are the long-lived `feat/communities` and `feat/curate` (N2). | Yes, with N2 |
| 9 | PR numbers restarted at #1 (`cycle-staging` :35, OPERATIONS :319) | `gh pr list --repo nousclawds4/tapestry --state all`: #1, #2 and #3, all from 2026-10-27. `52bc03b6` is "Merge pull request #3". | Yes |
| 10 | Earlier PR links in OPERATIONS point at the old repo (OPERATIONS :319–320) | The only PR links are §9.7's #111 and #122, both `github.com/nous-clawds4/tapestry/pull/…`. | Yes. Bare numbers are not covered, see N5 |
| 11 | `whats-open.sh` lists the new repo's PRs (CHANGELOG :103) | `REPO="nousclawds4/tapestry"` is used by both `gh pr list --repo "$REPO"` calls (:275, :277). | Yes. Its cleanup section is a separate matter, see N3 |
| 12 | Every `gh` command in these skills targeted the old repo (CHANGELOG :103, Why) | `git show 52bc03b6:` of the four skills plus `director.md`: every `--repo` was `nous-clawds4/tapestry`. | Yes |
| 13 | "…on a repo that no longer deploys" (CHANGELOG :103, Why) | True in the sense that merges there no longer reach the droplets. Read next to #4 and #7, it says the opposite of the row's own next sentence. | **Wording, folded into B1** |

## Scope check (1): operational surfaces that decide where work goes

`git grep -n 'nous-clawds4' HEAD --` over `.claude/` (skills, commands, agents, settings), `scripts/`,
`engineering-team/{roles,workflows,templates,README.md}`, `docs/SMOKE_TEST.md`, `docs/SAFE_TO_MERGE.md`,
`OPERATIONS.md`, `AGENTS.md`, `CLAUDE.md`, `.github/` and `product-team/` finds only these:

- the new warning's own mentions (`cycle-staging` :30–31, OPERATIONS :315);
- the retired host name `nous-clawds4.tapestry.ninja` (OPERATIONS :73);
- §9.7's PR #111 and #122 links (OPERATIONS :384, :386), which are historical and correctly kept.

**Every `gh` invocation in those paths** either carries `--repo nousclawds4/tapestry` or `--repo "$REPO"`, or is prose
that names a command. `scripts/check-safe-to-merge.sh` has no GitHub access at all; it curls the instance.

**This checkout's `gh` default:** `gh repo set-default --view` reports no default set, and
`gh repo view --json nameWithOwner` resolves to `nousclawds4/tapestry`.

**Outside the brief's list, still operational (B2):** OPEN.md row 14 (:47) and row 209 (:233) are `OPEN` and carry
`gh` commands against the old repo.

**Historical, correctly left alone:**
- DONE rows 33, 145 and 337;
- ledger evidence citing old-repo PRs (`2026-10-10-ledger-fix-pr-merged-unreviewed`, `2026-09-20-promotion-bundle-body-goes-stale`, `2026-09-27-delete-pr-assets-dictionary-branch`);
- the audits, reviews and epics;
- `docs/*HANDOFF*`;
- `/Users/clawds4/repos/nous-clawds4/…`, which is a local directory path, not a slug.

## Historical statements (check 3)

No historical statement was rewritten.
- **Changed lines:** each one is a present-tense instruction (`--repo` flags, the §6.3 clone step for a *new* droplet,
  the §9.1 fix line), or a new sentence dated "since the move of 2026-10-23".
- **Old PR links:** §9.7's are untouched.
- **Deferred items:** `docs/PREFERENCES_AUDIT.md`, the audits/reviews/epics, and the README/QUICKSTART/SECURITY/
  `information-for-agents`/`openapi.yaml`/`siteTrust.js` pointers are unchanged, as the brief intends.

## ADR adherence / Concept-graph integrity / Product-guide adherence

Not applicable: there is no ADR, no concept definitions changed (so no firmware reinstall), and nothing traces to a PRD.

## Things tests can't catch

- [x] No secrets in the diff. No debug code, no commented-out code.
- [x] Scope: the diff is limited to the brief's surfaces, plus the CHANGELOG row L10 requires.
- [ ] **Not caught by any check:** the repo move silently invalidated documented GitHub settings. See N1 and the friction item.

## House rules check

- [x] No new lint, typecheck or build tooling.
- [x] Concept Graph API authority: not touched.
- [x] TA-pubkey rule: not touched.

## Tests that pin a repo slug

`git grep -n 'nous-clawds4' -- test/` finds three files, and none of them reads a file this diff changes, so the
change breaks nothing.
- **`test/llms-txt.test.js:60–69`** pins the old-slug raw URLs that `src/utils/siteTrust.js` serves. It passes now
  (27/0). When the deferred siteTrust follow-up changes those URLs, it must change this test with them, or the suite
  goes red.
- **`test/site-trust-signals.test.js:54`** is a comment only.
- **`test/dictionary-github-account.test.js:66`** normalizes a GitHub *login* string. It is not a repo address, and
  it should stay.

## Findings

### Blocking

1. **`.claude/skills/cycle-staging/SKILL.md:31`.** "It is not wired to the droplets" is contradicted by the old
   repo's configuration.
   - **The evidence:** its deploy workflows are `active`, its repository secrets still carry the deploy configuration
     those workflows use, and each deploy job SSHes into the droplet and rebuilds it.
   - **Why it matters:** the paragraph's own line 33 ("A push there can start an out-of-band deploy") is true only
     *because* the repo is still wired, in the CI sense. A session weighing the owner's "keep the two in sync"
     against this warning could read "not wired" as "harmless" and mirror `staging`.
   - **The CHANGELOG row (:103, Why)** has the same tension: "on a repo that no longer deploys".
   - **Asked change:** say only what is verified. Suggested wording, which is itself a claim for the next round to
     check: "The droplets no longer pull from it, but its deploy workflows are still active and its repository
     secrets still hold their deploy configuration, so its deploy workflows fire on pushes to `staging`, …". In the
     CHANGELOG row, write "on a repo whose merges no longer reach the droplets", or equivalent.
2. **`OPEN.md:47` (row 14) and `OPEN.md:233` (row 209).** Both are `OPEN`, and both tell a session to run `gh`
   against the old repo. These are operational references that decide where work goes, so they fall inside the
   change's stated intent, and they are not historical.
   - **Row 14:** its still-open part ends "read `gh api repos/nous-clawds4/tapestry/rules/branches/main`". Today
     that returns the old repo's `deletion, non_fast_forward, pull_request, required_status_checks`, while the same
     call against `nousclawds4/tapestry` returns no rules for `main` or `staging` (N1). A session working this row
     would come away falsely reassured.
   - **Row 209:** its fix shape says "add a `gh pr checks <PR#> --repo nous-clawds4/tapestry` step to
     `/cycle-staging`". That would put the old slug back into the file this diff just fixed.
   - **Asked change:** repoint both commands to `nousclawds4/tapestry`. In row 14, say that the ruleset it names
     (id 15863292) is the old repo's. Edit both rows in place; ids and positions don't change.

### Non-blocking

1. **Owner action, high priority: the new repo has none of the branch rules the docs describe.**
   - **Old repo:** `gh api repos/nousclawds4/tapestry/rulesets` is empty, and `rules/branches/{main,staging}`
     return nothing. On `nous-clawds4/tapestry` the same calls return `restrict-deletions` and
     `main-requires-pr-before-merging`.
   - **Docs that state those rules as standing facts:** OPERATIONS §4 (:102–107), §9.2's "permanent fix" (:332),
     §15's required-check note (:995) and row 14.
   - **What is lost:** `/cycle-prod`'s `BLOCKED` path (`cycle-prod/SKILL.md:151`) caught a premature promotion merge
     on 2026-09-11 (row 209, #641), and it will not fire on the new repo.
   - **Partial mitigation:** `delete_branch_on_merge` is `false` on the new repo, so §9.2's incident cannot recur by
     that route today.
   - **Suggestion:** the owner recreates the two rulesets, adding `feat/tags` per row 14. Until then, a promotion
     merge must wait for `stack-free` and `main-source-guard` by hand. Track this with a ledger row.
2. **`cycle-staging/SKILL.md:31–34`, OPERATIONS :317–318: the never-push list is narrower than the real trigger set.**
   - **The mechanism:** a push fires the workflows in the *pushed commit's* tree.
   - **The extra branches:** `origin/feat/communities` carries `deploy-communities.yml` (push: `[feat/communities]`),
     and `origin/feat/curate` carries `deploy-curate.yml`, which is `active` on the old repo.
   - **The risk:** their droplets are decommissioned, so a run would fail rather than deploy. But both are `feat/*`
     names that "feature branches may be mirrored" would sweep in.
   - **Optional:** define the never-push set as "the branches in `scripts/long-lived-branches.txt`". That is the
     existing single source, and it already covers these two.
3. **`scripts/whats-open.sh:293–301` ("Unmerged feature branches vs origin/main (candidate cleanup)").**
   - **The behavior:** `git branch -r` lists every remote, while the keep-pattern exempts only `origin/…`.
   - **In this checkout:** it lists 28 `nous-clawds4/*` refs as cleanup candidates, including
     `nous-clawds4/staging`, `nous-clawds4/feat/tags` and `nous-clawds4/feature-magic-carpet`, which are the
     branches the new warning protects.
   - **Origin:** pre-existing, but it only matters now that the second remote exists.
   - **Optional follow-up:** restrict the section to `origin` refs, with a rollup test.
4. **The follow-ups the brief defers have no surface.** A search of `ledger/`, `OPEN.md` and
   `stories/_intake.md`, plus `origin/staging`, finds no row for the repo move. Per OPEN.md's write discipline, one
   row before session end should carry:
   - **(a)** the public pointers. That means the brief's list plus three it doesn't name:
     `ui/src/pages/developers/Hub.jsx:54`, `ui/src/pages/developers/OpenRanking.jsx:162`, and
     `docs/INTEGRATION_GUIDE_event-tagging-for-external-clients.md:35,74,82`. The last of these sends external
     integrators to the old repo's `feat/tags`, which goes stale under this change's own never-push rule. Include the
     `llms-txt` test coupling noted above.
   - **(b)** the sync tension. The owner wants the two repos in sync, but the old `main` and `staging` are already 8
     and 9 commits behind, and the rule keeps them there. Pushing those branches becomes safe only after an owner act
     on the old repo: disable its deploy workflows, or clear their deploy configuration.
   - **(c)** N1.
   - **(d)** N3.
5. **OPERATIONS.md:319–320.** "Earlier PR links in this file" covers the two links, but the file also carries bare
   old-repo numbers: :67 PR #35/#46, :131 PR #119, :354 #82/#81/#84/#85, :370 PRs #681… Optional wording: "Earlier
   PR numbers and links in this file refer to the old repo."
6. **OPERATIONS.md:309–312 (§9.1), pre-existing lines next to the edit:**
   - "This local checkout has two remotes … `upstream`": this checkout has no `upstream`.
   - "our fork": `nousclawds4/tapestry` is not a GitHub fork (`fork: false`).
   - A checkout that once followed the old fix line (`gh repo set-default nous-clawds4/tapestry`) keeps that default
     through a remote rename, so every `gh` command run without `--repo` there still targets the old repo.
   - **Optional:** add "check `gh repo set-default --view`" to the fix line.

### Harness friction

1. **GitHub settings documented as standing facts aren't checked against anything.** OPERATIONS §4, §9.2 and §15
   describe rulesets, auto-delete and required checks as facts, with no repo named and no "as of" date. No lint or
   digest checks them, so the repo move invalidated all three and nothing noticed. This review found the gap by
   asking the API. Candidate `meta` row, for the session to file. It is not filed here.
2. **`templates/review-checklist.md:64` (`## On PASS (same commit)`) is read as a verdict.** The heading follows the
   verdict, so `scripts/lib/review-verdict.awk`'s last-token rule reads a single-round CHANGES_REQUESTED review that
   keeps it as **PASS**. That covers `harness-lint` L1/L4 and the `harness-stats` tallies.
   - **Seen here:** this file, written to the template, read `PASS` until that section was folded into the line below.
   - **Not checked:** how many existing single-round CR reviews it affects. The multi-round reviews sampled end in a
     real PASS.
   - Candidate `meta` row.

## Verdict
The template's "On PASS (same commit)" section doesn't apply: there is no story file to flip, and this review does not
pass. It is folded in here so the verdict stays the file's last verdict token (harness friction 2).

**CHANGES_REQUESTED**

---

# Re-review, round 2

**Date:** 2026-10-28 (UTC). This round ran from about 02:28Z to 02:40Z.
**Diff:** `git show 3df390dd` (on `983d94f0`; the round's commit is stamped 22:27 -0400 on 2026-10-27, which is
02:27Z on 2026-10-28). Six files changed: `.claude/skills/cycle-staging/SKILL.md`, `OPEN.md`, `OPERATIONS.md`,
`engineering-team/CHANGELOG.md`, `scripts/whats-open.sh`, and the new `ledger/2026-10-28-repo-move-follow-ups.md`.
55 insertions, 13 deletions. The branch is now three commits on `origin/staging` `52bc03b6`.

**How the fixes were checked.** Every changed statement was re-derived from a command, as a fresh claim. That includes
the wording this review suggested in round 1 (`roles/reviewer.md` step 10).

**Side effects this round.** None in the worktree beyond appending this section. Network calls were reads only:
- `gh api` GETs of rulesets and branch rules on both repos;
- `git ls-remote` of both repos' `main` and `staging`;
- one `gh issue view` and one `gh api …/issues/63`;
- one probe of `gh repo set-default` in a throwaway repo under the scratchpad, since deleted.

Running `scripts/whats-open.sh` did its own `git fetch -q origin main staging`. No ref moved: `origin/main` is
`3e9a31ee` and `origin/staging` is `52bc03b6`, both equal to `ls-remote`.

## Gates

- [x] **`bash scripts/harness-lint.sh`**, gated on `$?`: **exit 0**, `harness-lint: clean (0 violations)`.
  - **L10:** the latest harness-definition commit is now `3df390dd`, and it touches `engineering-team/CHANGELOG.md`.
    It edits row :103 in place: one logical change, one row, still four columns.
  - **L9:** `OPERATIONS.md` says 2026-10-28; its last change is 2026-10-27 local.
  - **L15:** the new ledger file's name, `**Id:**`, `**Type:**`, `**Status:**` and `**Opened:**` fields pass.
- [ ] **`npm test`:** not run, by the brief's instruction; there is no `gate:status` line. The same eight targeted
  suites were re-run through `run()` on Node v22.23.3 against this tree. All pass, with the same counts as round 1:

  | Suite | Pass | Fail |
  |---|---|---|
  | `rollup-scanners` | 33 | 0 |
  | `session-start` | 32 | 0 |
  | `safe-to-merge-check` | 16 | 0 |
  | `operational-direction` | 86 | 0 |
  | `ci-test-job` | 14 | 0 |
  | `harness-lint` | 85 | 0 |
  | `gate-result-record` | 34 | 0 |
  | `llms-txt` | 27 | 0 |

  No suite exercises whats-open's cleanup listing (no test mentions `branch -r`), so that change was checked by
  running it (row W below).

## Round 1's findings, each re-derived

| Finding | What changed | Evidence this round | Status |
|---|---|---|---|
| **B1** "not wired to the droplets" | `cycle-staging` :31–34 and OPERATIONS :316–319 now say the droplets "are meant to follow" the new repo, and that the old one "keeps its GitHub Actions and its deploy secrets". The CHANGELOG Why (:103) reads "a repo the droplets no longer follow" and names the Actions and secrets. | The old repo's 8 workflows are `active`. Its secrets carry the deploy configuration (names only). "Meant to follow" correctly hedges what no droplet inspection confirmed. Nothing now says the old repo is harmless, and line 33's "can start an out-of-band deploy" follows from the text before it. | **Resolved** |
| **B2** rows 14 and 209 | Each gains a dated note with the new slug. Row 14 (OPEN.md:47) also notes "no rulesets at all" and points at the new ledger row. Row 209 (:233) gives `--repo nousclawds4/tapestry` beside the old command. | The old commands are kept as history, and the note sits directly after each one. A session reading either row is sent to the new repo. Row 14's no-rulesets note, re-read at 02:36Z: `gh api repos/nousclawds4/tapestry/rulesets` has length 0 and `rules/branches/main` is empty; the old repo has 2 rulesets. | **Resolved** |
| N2 never-push set | Now "the long-lived deploy branches in `scripts/long-lived-branches.txt`", naming `staging`, `main`, `feat/tags`, `feature-magic-carpet`, `feat/communities` and `feat/curate`. | Across every `origin` branch's own tree, those six are exactly the branches whose push fires a workflow in their own tree. The keep-list's other three (`feature-relay-discovery`, `feature-tapestry-discovery`, `fix/launch-child-task-protection-audit`) fire nothing when pushed. | Resolved |
| N3 (row W) whats-open cleanup | `git branch -r --list 'origin/*' --no-merged origin/main`, in both places (:302, :305). | Before the change: 28 `origin/*` rows, and old-remote rows as well. After: the same 28 `origin/*` rows and 0 others. Nested names still match (`origin/feat/tags` is listed). The rendered section shows 21 rows after the keep-list filter, the same `origin` set as round 1, with no `nous-clawds4/*`. `rollup-scanners` and `session-start` pass. | Resolved |
| N4 untracked follow-ups | New `ledger/2026-10-28-repo-move-follow-ups.md`. | Re-checked at 02:36Z: rulesets 0 vs 2; old `main` and `staging` 8 and 9 behind (`ls-remote` SHAs `b764663d`→`3e9a31ee`, `4b6326d1`→`52bc03b6`). Every pointer it lists is at the cited line, and `openapi.yaml`'s is `info.contact.url`. "The CLIs stay under `nous-clawds4` (BIBLE §3)" holds: BIBLE :86 and :98 sit in "## 3. Repos and Branches". The secrets are stated generically. | Resolved; see R2-2 |
| N5 bare `#N` | OPERATIONS :320: "Earlier PR references in this file, links and bare `#N` alike, are the old repo's". | Every PR number in the file was listed: #29, #32, #35, #46/#47, #50/#51, #81, #82, #84, #85, #88, #90, #92, #111, #119, #122, #681/#682. All predate the move. The other `#N` are stories, OPEN.md rows, ToC anchors or list items. | Resolved; see R2-3 |
| N6 §9.1 remotes and set-default | "A checkout may carry these remotes" (:311); a new `gh repo set-default` bullet (:322). | The first holds. For the second, see R2-1. | Resolved; see R2-1 |
| N1 owner action (rulesets) | Ledger item 1. | As above. | Tracked |
| Friction 1 (settings documented as standing facts) | Not addressed. | Still a candidate `meta` row. Not filed. | Open, non-blocking |
| Friction 2 (template's `## On PASS` heading) | Not done, by choice; the coordinator will check for an existing row. | — | Noted |

## New in this round (non-blocking)

1. **R2-1, OPERATIONS.md:322.** "One made before the move still names the old repo" is broader than what gh does.
   - **The probe:** gh stores the default as `remote.<name>.gh-resolved base`, and it follows that remote's URL.
   - **When the sentence is true:** for the layout this section describes, where the old remote was renamed to
     `nous-clawds4` and a new `origin` added. `--view` then still reports `nous-clawds4/tapestry`.
   - **When it is false:** for a checkout moved with `git remote set-url origin …`, the default follows to
     `nousclawds4/tapestry`.
   - **Effect:** "re-run it" is safe in both cases. Optional wording: "One made before the move still names the old
     repo if the old remote was renamed rather than re-pointed; check with `gh repo set-default --view`."
2. **R2-2, ledger `2026-10-28-repo-move-follow-ups.md:16`.** "`/cycle-prod`'s wait for `BLOCKED` to clear never fires"
   misdescribes the skill.
   - **What the skill has:** no wait. It has a `BLOCKED` *stop* at `cycle-prod/SKILL.md:151`. The wait-for-`CLEAN`
     workaround lives only in agent memory, per row 209.
   - **What holds:** the consequence ("a merge seconds after a promotion PR opens would go through") and the owner
     action are right.
   - **Optional wording:** "So GitHub no longer reports `BLOCKED` for a pending required check, and `/cycle-prod`'s
     `BLOCKED` stop (SKILL.md:151) never fires."
   - **Also:** `**Type:** ops` is outside the template's list (`bug | feature | protocol | docs | cleanup | meta`).
     22 table rows use `ops`, and the lint and readers take only the first word, so nothing breaks.
3. **R2-3, OPERATIONS.md:294 (§8 "Active tracking issues").** "#63 — Meilisearch upgrade" is an *issue*, still `OPEN`,
   and it exists only on the old repo (`gh api repos/nousclawds4/tapestry/issues/63` returns 404). The new
   "Earlier PR references…" sentence doesn't cover issues. A session resolving `#63` against the now-default repo
   finds nothing, or eventually a different item. Optional: "PR and issue references", or name the repo at §8's
   entry. This is a new observation, not a defect in the fix.

None of the three changes what a session does next, so none blocks.

## Verdict (round 2)
Both blocking findings are resolved and checked against fresh evidence. The non-blocking items are tracked, fixed, or
optional. There is no story to flip and no book: this is the doc / harness lane, with no `audits/<book>/book.md`, so
completion detection has nothing to compute.

**PASS**
