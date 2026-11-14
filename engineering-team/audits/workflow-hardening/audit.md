# Build Audit: The GitHub workflows pin what they run, limit their token, and name a deploy environment

**Book:** `engineering-team/audits/workflow-hardening/book.md`
**Date:** 2026-11-14
**Branch / commit range:** book work `1dc1ca44..139b14d3` on `feat/workflow-hardening` (15 commits and 2 merges of `staging`; 26 files, +2,000 −30). Merged to `staging` as TapestryProtocol/tapestry#54, merge `55573a32`, 2026-11-14. Not on `main`, `feat/tags` or `feature-magic-carpet`.
**Provenance:** Acceptance-frame (no PRD), confirmed by the owner at intake. Human-gated; Standard strictness, Bug lane, Architecture skipped at intake.
**Confidence:** high for the six bullets of the frame, each shown on `staging` by a run. The frame stops at `staging`: production's copy of its workflow, and where the secrets live, are unchanged (§4, §6).

> As-built record for the book that made every GitHub workflow in this repo pin the actions it runs, declare its token's permissions, and name a deploy environment wherever it reads a deploy secret, with a test suite that holds the three rules.

## 1. What shipped

- **Every action a workflow calls is pinned to a commit.** Twelve calls to six actions, in six workflow files. Each pin is the commit its tag pointed to on 2026-11-13, so nothing was upgraded. — `stories/workflow-hardening/1-harden-the-github-workflows.md` (AC-1)
- **Every workflow declares what its token may do.** Five workflows gained a declaration: the four deploy workflows give the token nothing, and the test gate reads the repository. Two already had one. — AC-2
- **Every job that reads a deploy secret names its server's environment:** `tapestry`, `staging`, `tags`, `magic-carpet` and `ninja`. — AC-3
- **`npm test` holds the three rules for every workflow file,** including one added later, and names the file and the rule when one is broken. — AC-4
- **The operator docs say how to use it:** OPERATIONS.md §18 (the rules, how to move a pin, how to set up an environment and the order for moving a target's secrets), §6.2 for a new target, and the `ninja` box's runbook. — AC-5
- **Deploys and the test gate behave as before.** — AC-6, shown by the runs in §5.

## 2. Epics & stories rolled up

### Epic: `workflow-hardening`

| Story | Delivered | Status | Review |
|---|---|---|---|
| #1 harden-the-github-workflows | The three rules in six workflow files, the guard suite, the operator docs | Done | `reviews/workflow-hardening/1-harden-the-github-workflows.md`: three rounds, by a reviewer separate from the author. Round 1 CHANGES_REQUESTED (two blocking), round 2 CHANGES_REQUESTED (one blocking), round 3 PASS. |

No ADR. The owner skipped Architecture at intake as obvious for a Bug.

## 3. As-built inventory (from the diff)

- **Workflows (6 files changed, 1 untouched).**
  - `deploy-tapestry.yml`, `deploy-staging.yml`, `deploy-tags.yml`, `deploy-magic-carpet.yml`: `permissions: {}`, an `environment:` line on the job, and `appleboy/ssh-action` at `0ff4204d` (v1.2.5).
  - `test.yml`: `permissions: contents: read`; `actions/checkout` at `fbc6f399` (v5.1.0) and `actions/setup-node` at `a0853c24` (v5.0.0).
  - `publish-image.yml`: `environment: ninja`; five calls pinned (`actions/checkout`, `docker/setup-buildx-action` v3.12.0, `docker/login-action` v3.7.0, `docker/build-push-action` v6.19.2 twice, `appleboy/ssh-action`). Its permissions were already declared.
  - `guard-main-source.yml`: untouched. It calls no action, reads no secret, and already declared its permissions.
- **Tests.** `test/workflow-hardening.test.js` is new: 27 tests, registered in `test/registry.js`. Three assertions in `test/ci-test-job.test.js` (W3, W4, W9) now name the gate's two actions by commit. A comment in `test/honest-publish-reporting-ci-guard.test.js` no longer cites a line number.
- **Docs.** OPERATIONS.md: a new §18, and edits to §1, §3, §6.2, §6.3 and the contents list. `deploy/RUNBOOK.md`: step 7 of Handover 1.
- **In GitHub, outside the repo's files.** The merge's first runs created two environments, `staging` and `ninja`, at 2026-11-14T03:26:08Z. Each is empty: no secrets, no rules, no branch limit.
- **User-facing:** nothing. No screen, endpoint or command changed.
- **Domain:** no concept touched; no firmware reinstall.
- **Data & contracts:** none.
- **Records.** Seven ledger rows opened by this book, four on the branch and three at this close (§5, §7); two existing rows given another occurrence; one row closed; one intake entry; and the harness changelog row the workflow change required.

## 4. Deviations from intent

The anchor is the six-bullet acceptance frame in `book.md`.

| # | Specified (anchor) | Built | Type | Rationale (source) | Product impact | Carry-forward |
|---|---|---|---|---|---|---|
| 1 | "Every action a workflow calls is pinned to a full commit." | All twelve calls are pinned. A pin fixes the action's own files, not what the action fetches when it runs: `appleboy/ssh-action` downloads its SSH client from a release at run time, with no checksum. | constraint-discovered | Review round 1, non-blocking 7; OPERATIONS.md §18.1 says so. | The step that is handed a server's key still runs a program fetched at run time. | Intake entry of 2026-11-13. |
| 2 | "Every workflow declares what its token may do, and none can write to the repository's contents." | Met. The deploy workflows give the token nothing, where the story would also have allowed read access. | interpretation | Story, Deviations. The action needs no token (review round 1). | None. | — |
| 3 | "Every job that reads a deploy secret names a GitHub environment: `tapestry`, `staging`, `tags`, `magic-carpet` or `ninja`." | True of the files on `staging`. Each long-lived deploy branch runs its own copy of its workflow, and `main`, `feat/tags` and `feature-magic-carpet` do not carry the change. So GitHub has created `staging` and `ninja` only. | constraint-discovered | Epic, Key facts; review round 1, non-blocking 4. | Production's and the two sandboxes' deploy jobs name no environment yet. | Promotion to `main`; the sandboxes' next sync. |
| 4 | The same bullet. | `feature-magic-carpet` holds two workflows that `staging` doesn't, `configure-prod.yml` and `deploy-brainstorm.yml`. Both name deploy secrets, call their action by a tag, and declare neither permissions nor an environment. The story counted workflows on `staging` only. | constraint-discovered | Review round 1, non-blocking 4; `book.md`, "What stays open". | The guard will fail on that branch when the change reaches it, until the two files follow the rules or go. | That branch's owner, at its next sync. |
| 5 | "The settings work in GitHub (limiting each environment to its branch, moving the secrets in) stays with the owner and is not part of this book." | As framed: the workflows carry the line, and the secrets are still at repository level. | deferred (by the frame) | `book.md`; story, Out of scope. | Nothing about who can read a deploy secret has changed yet. The line is what makes the change possible. | Owner: OPERATIONS.md §18.3, one target at a time. |
| 6 | "A test in `npm test` fails when a workflow breaks any of the three rules above." | The suite holds a fourth rule too, that a file it cannot read is a finding, and reads more than the frame names: an image run as a step must be pinned to a digest, and a job that reads secrets without naming them fails. | added-beyond-scope | Test plan, Edge cases; review rounds 1 to 3. | A workflow that reads every secret at once fails the suite. | Test plan, "Not covered": a local action's own file, and `container:` and `services:` images. |
| 7 | The same bullet. | One test-only commit (`7f5245a0`) follows the passing review and was not reviewed. It closes two forms round 3 named, and only widens what the guard reads. | interpretation | Story, Deviations; the pull request's description. | None. | — |
| 8 | "OPERATIONS.md says how to set up a deploy target's environment and how to move a pin." | Met, in §18 rather than §17: `staging` gained a §17 while the book was open. `deploy/RUNBOOK.md` changed too, because it set up the `ninja` box's secrets at repository level. | added-beyond-scope | Review round 1, B1; review round 2, R2-B1; story, Deviations. | None. | — |
| 9 | Not in the frame. | TapestryProtocol/tapestry#51, another book's fix for a test that was red on every pull request into `staging`, was merged first so that this book's gate could be green. Its ledger row was closed on this book's branch. | added-beyond-scope | The owner's choice, 2026-11-14; test plan, "`V3`, as it ran". | Pull requests into `staging` read green again. | — |
| 10 | Workflow 4 and workflow 5: "Run the gate." | The full `npm test` was not run on the development machine in any phase after Test Design. The gate of record is the pull request's `Test` run. | constraint-discovered | Story, Deviations; OPEN.md row `2026-11-13-live-suites-have-no-off-switch`. | None. | That row. |

**Undocumented work:** none found. Every file in the diff traces to the story, the test plan, a review finding or a ledger row.

## 5. Quality state at close

- **Test gate, for the code that shipped.** The pull request's `Test` run on the head that merged (`139b14d3`, run 43550924405): `Overall: PASS — 7090 passed, 0 failed, 593 skipped across 339 suites · record tmp/gate-runs/20261114T031832Z-2380-4165.json`. The run before it (`7f5245a0`, run 43529310291) read 7,089 passed, 1 failed; the one failure was the test that pull request 51 then fixed.
- **Test gate, for the tree this close leaves.** Not run on the development machine, for the reason in deviation 10. It is the `Test` run of the pull request that carries this close. On that tree before the commit: the harness lint clean, and seven suites that need no stack, run one at a time: the guard 27 of 27, `ci-test-job` 14 of 14, `brains-launcher-repo` 31 of 31, `harness-lint` 85 of 85, `rollup-scanners` 33 of 33, `ledger-row-ids` 6 of 6 and `session-start` 32 of 32.
- **Verified by a run, after the merge (`55573a32`):**
  - `Deploy to Staging`, run 43551615727, succeeded in 1m29s. Its log shows the SSH action fetched at the pinned commit. This was the first run of a deploy workflow with an empty token and a named environment.
  - `Publish brain images`, run 43551615729, succeeded in about 12 minutes, including the roll. `tapestry.ninja` answered afterwards and one brain reported ready.
  - `staging.brainstorm.world` passed the smoke test: readiness on the first three polls, seven pages and the public APIs at 200, search with hits, and three unrelated endpoints at 200. `/api/get-user-data` returned 504 for the large-graph test account, which `docs/SMOKE_TEST.md` expects.
- **Not verified by a run:** `deploy-tapestry.yml`, `deploy-tags.yml` and `deploy-magic-carpet.yml`. Each runs only on a push to its own branch, and none of those branches carries the change.
- **Known and accepted at close:**
  - The deploy secrets are still at repository level (deviation 5).
  - Two of the pinned Docker actions target Node 20 and are forced onto Node 24, per an annotation on run 43551615729. The same was true of the tags they replaced.
  - `npm ci` on 2026-11-13 reported 17 advisories against the lockfile, one rated critical. Not this book's, and not triaged (OPEN.md row `2026-11-14-npm-reports-seventeen-advisories`).
- **Debt.** Pins age: nothing moves one when an action ships a fix. The guard's known gaps are listed in the test plan under "Not covered".

## 6. Carry-forward register

- [ ] **Limit the `staging` and `ninja` environments to their branches, move each one's three secrets in, and delete the repository-level copies.** Both branches carry the line, so both can be done now. (§4 #5; OPERATIONS.md §18.3)
- [ ] **Promote to `main`,** so that production's deploy workflow carries the change. Then do the same for `tapestry`. (§4 #3)
- [ ] **Bring `feat/tags` and `feature-magic-carpet` up to the change,** then do the same for `tags` and `magic-carpet`. (§4 #3)
- [ ] **On `feature-magic-carpet`, bring `configure-prod.yml` in line and decide whether `deploy-brainstorm.yml` stays.** It triggers on a push to `main` and names secrets the repo no longer has. (§4 #4)
- [ ] **The SSH step's run-time download, the host key, what the guard does not read, and how pins are kept current.** Queued in `stories/_intake.md`, entry of 2026-11-13. (§4 #1, #6)
- [ ] **Move the two Docker action pins to releases that target Node 24.** (§5)
- [ ] **The story's Out of scope items that are not this book's to close:** who has write access to the repo and their tokens, and items 2 and 3 of OPEN.md row `2026-10-28-repo-move-follow-ups` (the old mirror's Actions and secrets, and the public pointers that still name it).

## 7. Process findings (harness)

`scripts/harness-stats.sh`, run at this close: 1,984 phase commits; 321 reviews decided, with its headline kick-back rate at 0% and churn 3; Direction gates 94 approve, 14 kick-back, 6 halt; books 11 open and 92 closed; median cycle time 0 days. This book's one story took three review rounds, two of them CHANGES_REQUESTED, and each round found something a suite could not: a doc that contradicted the change, a plan that promised a result the branch could not give, a base branch that had moved, and two forms the guard had stopped catching.

| Finding | Source | Terminal state |
|---|---|---|
| A full `npm test` writes to whatever stack answers as `tapestry`, and no single setting turns the live suites off. On the development machine that container was a long-lived instance; the Tester's baseline run wrote 103 events and 84 graph nodes to it, which the owner had removed the same day. The Reviewer role, workflow 5 and the review template all say to run `npm test`, and none says what a full run does to a stack that answers. | Test Design baseline; review round 1, Harness friction 1 | OPEN.md row `2026-11-13-live-suites-have-no-off-switch` |
| A test plan named the pull request's CI run as its gate while a suite on `staging` was already red. | Review round 1, B2 and Harness friction 4 | OPEN.md row `2026-11-13-plan-names-ci-gate-already-red` |
| A story about "every workflow" counted the workflows on one branch. | Review round 1, non-blocking 4 and Harness friction 5 | OPEN.md row `2026-11-13-story-counts-files-from-one-branch` |
| Review has no check of where the target branch is. Round 1 reviewed a branch that could no longer merge. | Review round 2, R2-B1 and Harness friction | OPEN.md row `2026-11-13-review-has-no-origin-drift-check` |
| The review template's "On PASS" heading reads as a verdict to the lint, so a review that requests changes lints as a pass unless the section is moved by hand. | Review round 1, Harness friction 2 | OPEN.md row `2026-10-07-on-pass-heading-reads-as-verdict` (one more occurrence recorded) |
| `scripts/harness-def-paths.txt` says the workflows are retired and none runs. | Review round 1, Harness friction 3 | OPEN.md row `2026-10-29-h2-0-baseline-predates-github-flow` (one more occurrence recorded) |
| A reviewer agent has Write and no Edit, so each round re-emits the whole review file. By round 3 that was 524 lines. | Review round 3, Harness friction | OPEN.md row `2026-11-14-review-rounds-re-emit-the-file` |
| The cycle skills look for a run every 10 seconds and watch it at `gh`'s default pace, which is faster than the team's rule for GitHub requests. This book ran them at 20 and 30 seconds. | Book close: both merges of 2026-11-14 | OPEN.md row `2026-11-14-cycle-skills-poll-github-fast` |
| Epic close-out moves a story, its test plan and its review one folder deeper, which breaks every relative link in them that leaves the folder. Workflow 5 says no link needs rewriting. This close rewrote four. | Book close, step 9 | OPEN.md row 312, which records the same break for ADR citations |
| A fix made between review rounds narrowed what the guard reads, and let through two forms the earlier code caught. Round 3 caught it. | Review round 3, non-blocking 1 and 2 | Declined: both forms are now test cases (`S11`, `S13`, `S13b`), which is the fix. The lesson, to keep the old cases when a checker is rewritten, is the Tester's ordinary care, and the next rewrite would fail those cases. |
| Workflow comments named an OPERATIONS.md section by its number. A renumbering then reached into six workflow files, each a harness-definition path. | Review round 2, R2-B1 | Declined: fixed in the book, where the comments now name the section. One occurrence, with an obvious fix. |
| The commit after the passing review was not reviewed. | Story, Deviations | Declined: test-only, disclosed in the story and the pull request, and widening only. A fourth round would have cost more than the three before it found. |

**Does each port to the other flow?** The first four rows and the review-file row bind Direction-mode books as much as human-gated ones: a Director's reviewer is the same agent with the same role file. The cycle-skill row binds every book that ships.
