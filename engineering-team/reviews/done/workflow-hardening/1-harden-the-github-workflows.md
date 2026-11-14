# Review: Story 1 — The GitHub workflows pin what they run, limit their token, and name a deploy environment

**Reviewer:** Claude (acting as Reviewer)
**Date:** 2026-11-13
**Diff:** `git diff origin/staging...HEAD` (base `6c57ec1f`, HEAD `0af83004`: story `1dc1ca44`, failing tests `8b6931bb`, a ledger row `495e0458`, implementation `0af83004`)
**Story:** [1-harden-the-github-workflows.md](../../../stories/done/workflow-hardening/1-harden-the-github-workflows.md) · **ADR:** none (Architecture skipped at intake) · **Test plan:** [1-…test-plan.md](../../../stories/done/workflow-hardening/1-harden-the-github-workflows.test-plan.md)

**In short.** The workflow changes are right. All 12 action calls are pinned to the commit their tag points to today, and that commit is the release each comment names. Every workflow declares its token's permissions, the five deploy jobs name the right environments, and nothing else in any workflow changed. I found no reason the workflows would stop running. Two things block, and neither is in a workflow file:

1. The runbook for the `ninja` box still tells an admin to add its deploy key as a repository secret, which is what the new §17.3 says not to do (B1).
2. The test plan takes this story's full gate from the pull request's `Test` run and says that run must be green. An open ledger row says every pull request into `staging` is red on one unrelated test, and that test still fails on this tree (B2).

The guard has real holes. None of them blocks (non-blocking 1 to 3).

## Quality gates (run by reviewer, not trusted)

- [ ] **`npm test`: not run.** On this machine the container named `tapestry` is a long-lived instance, not a scratch stack, and a full run writes to it (`ledger/2026-11-13-live-suites-have-no-off-switch.md`). The launching task forbids the full run here, and the test plan (`:95-98`) takes the full gate's result from the pull request's `Test` run. So this review holds **no full-gate result for this code**.
  - No `npm run gate:status` line is quoted, and I did not run it. The only record on this machine is the Test Design baseline: run `20261113T204400Z-47565-3703`, taken at `1dc1ca44` with the test changes uncommitted, verdict FAIL. It is not a run of this code.
  - That record does bear out the test plan's red-first counts (`workflow-hardening` 19 passed and 7 failed, `ci-test-job` 11 and 3, `brains-launcher-repo` 31 and 0). It also has `setup-alert-polish` at 16 passed, 1 failed (B2).
- [x] **Three suites, run one at a time** through their `run()` exports at `0af83004`, on Node 24.18.0, with `TAPESTRY_CONTAINER`, `TAPESTRY_PORT` and `BRAINSTORM_BASE_URL` pointed at nothing. They are the guard and the two suites that hold `test.yml` and `publish-image.yml`: the three the launching task allowed. **They are not the full gate.**

  | Suite | Passed / failed / skipped |
  |---|---|
  | `workflow-hardening` | 26 / 0 |
  | `ci-test-job` | 14 / 0 |
  | `brains-launcher-repo` | 31 / 0 / 0 |

- [x] **Other suites that read a changed file: read, not run.**
  - Seven more suites open OPERATIONS.md: `bullboard-admin-access`, `generalized-task-scheduler`, `reconciliation-incremental-mode`, `reconciliation-rearchitecture`, `router-stream-limit-on-connect`, `task-queue-bullmq` and `task-queue-neo4j-resource-class`. Each checks that text about its own subject is present: the queue in §10, reconciliation in §12, the scheduler in §13, and the "What a deploy does" paragraph (`OPERATIONS.md:875`). This diff's seven hunks are elsewhere: the header, the contents list, §1, §3, §6.2, §6.3 and the new §17.
  - `stack-free-npm-test` G5 needs every suite file registered or excluded. The guard is registered (`test/registry.js:161`).
  - `harness-lint`'s tests lint the real repo, the new ledger row and records included. The script itself is clean (next line).
- [x] **`bash scripts/harness-lint.sh`:** clean, 0 violations, before this file was written and after.
- [x] **The guard suite rule.** `git show --name-only 0af83004 -- test/` and `git diff --name-only 8b6931bb HEAD -- test/` are both empty, so Phase 4 left `test/` alone. The test commit changed three assertions in `test/ci-test-job.test.js` (W3 `:94`, W4 `:104`, W9 `:175`) with their comments, added one registry line and added the guard. Nothing else under `test/` changed.
- [x] **Red before green, re-derived.** I ran the guard's own checkers, as committed in `8b6931bb`, over the workflow files and OPERATIONS.md of that commit, in memory. They give 11 PIN, 5 TOKEN and 5 ENV findings and neither doc section: the test plan's numbers. Over HEAD they give 0, 0 and 0, with both sections present.
- [x] **Probes.** Made-up workflows fed to the guard's checkers in a throwaway `node -e` (non-blocking 1 to 3), and each workflow file parsed before and after (V2). Nothing was written, and no file under `test/` was touched.
- [x] **GitHub, read only: ten requests.** Six `git ls-remote` (V1), two raw files of `appleboy/ssh-action` at the pinned commit, and two raw files of GitHub's documentation source (`github/docs`, `main`).
- [ ] `npm run test:playwright`: not applicable (no UI).
- [ ] _Lint not configured — skipped._
- [ ] _Typecheck not configured — skipped._
- [ ] _Build not configured — skipped._

## Would the changed workflows still run?

Nothing here can run a GitHub workflow. This is reasoned from the files, from the action's source at the pin, and from GitHub's documentation.

**Positions and syntax.** All seven files parse (js-yaml 4.1.1). `permissions` is a top-level key in each. `environment` sits on the job in the five deploy jobs. Each of the 12 `uses:` values parses to exactly `owner/repo@<40 hex characters>`, with the release comment outside the value.

**What each job needs from its token.**

| Job | What it does | What it needs | What it has |
|---|---|---|---|
| the four `deploy` jobs | one step, `appleboy/ssh-action` | Nothing. At the pin the action is a composite of two shell steps. It calls no other action and reads no token (`action.yml` and `entrypoint.sh`, read at `0ff4204d`). | `permissions: {}` |
| `stack-free` (`test.yml`) | checkout with full history, Node setup with the npm cache, `npm ci`, `npm test` | To read the repository. The `npm` steps are handed no token (`test.yml:27-30` sets one variable). | `contents: read` (`:20-21`) |
| `publish` (`publish-image.yml`) | steps unchanged | unchanged | `contents: read`, `packages: write` (`:52-54`), unchanged |

**A job that names an environment that does not exist yet.** GitHub's documentation, read today:

- "Running a workflow that references an environment that does not exist will create an environment with the referenced name. … the newly created environment will not have any protection rules or secrets configured." (`content/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments.md:95`)
- "if an organization, repository, and environment all have a secret with the same name, the environment-level secret takes precedence." (`content/actions/reference/security/secrets.md:25`)

So the first run creates each environment empty, and the job goes on reading the repository-level secrets, as the implementation commit says.

**What will look different after the merge.** These are expected, from GitHub's general behaviour, and are not defects:

- Environments appear in the repository's settings as each job first runs (`staging` and `ninja` on this merge), with a deployment recorded for each run.
- The merge rolls the brains, because `publish-image.yml` is in its own `paths` list (the test plan's V3 says so).
- If Required reviewers is later turned on for an environment, `/cycle-staging` and `/cycle-prod` will sit in `gh run watch` (`.claude/skills/cycle-staging/SKILL.md:127`, `.claude/skills/cycle-prod/SKILL.md:120`) until someone approves in GitHub.

**What I could not check from here.** These are settings and GitHub's own behaviour, and V3's runs are what will show them:

- The organization's policy on which actions may run. A policy that lists actions by tag would refuse a commit reference.
- That environments are available to this repository. They are for a public repository on any plan. The launching task says this one is public, and the clone at `OPERATIONS.md:239` uses no credentials; I did not ask GitHub.
- That a job with no token scopes still downloads a public action, that the Node setup's cache needs no token scope, and that the deployment record an environment creates needs none. All three are GitHub's general behaviour as I know it.

## V1: the pins, read a third time

`git ls-remote --tags https://github.com/<owner>/<repo> <tag> '<tag>^{}' '<tag>.*'`, six times, on 2026-11-13.

| Action | The tag points to, today | The release in the comment points to | Result |
|---|---|---|---|
| `actions/checkout` | `v5` → `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | `v5.1.0` → the same | matches the pin |
| `actions/setup-node` | `v5` → `a0853c24544627f65ddf259abe73b1d18a591444` | `v5.0.0` → the same | matches the pin |
| `appleboy/ssh-action` | `v1` → `0ff4204d59e8e51228ff73bce53f80d53301dee2` | `v1.2.5` → the same | matches the pin |
| `docker/build-push-action` | `v6` → `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` | `v6.19.2` → the same | matches the pin |
| `docker/login-action` | `v3` → `c94ce9fb468520275223c153574b00df6fe4bcc9` | `v3.7.0` → the same | matches the pin |
| `docker/setup-buildx-action` | `v3` → `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | `v3.12.0` → the same | matches the pin |

No output had a line ending in `^{}`: all six repositories use plain tags here, so each line is the commit itself. No tag has moved since the test plan's table was written.

## V2: nothing else changed

The test plan's command (`:129`) printed nothing. 45 changed lines went into it.

The command has two blind spots (non-blocking 6), so I also parsed each workflow as it is on `origin/staging` and as it is at HEAD. With the top-level `permissions`, each job's `environment` and the part of each `uses` after the `@` set aside, all seven files are equal, key for key and script for script. `guard-main-source.yml` is byte-identical. The 12 changed `uses:` lines keep their action names.

## Spec adherence

- [x] **Every acceptance criterion has a passing test,** in the three suites run here.

  | Criterion | Tests | Also checked by the reviewer |
  |---|---|---|
  | AC-1 pinned | R1, S1–S4; W3, W4, W9 | I read all 12 `uses:` lines. V1, above. |
  | AC-2 token | R2, R3, S5–S8 | One top-level block in each of the seven files and none on a job. The only write scope is `packages`, in `publish-image.yml:52-54`. |
  | AC-3 environment | R4, S9–S13 | Five jobs read deploy secrets: three each, of one server each. The names match (`deploy-tapestry.yml:19`, `deploy-staging.yml:22`, `deploy-tags.yml:14`, `deploy-magic-carpet.yml:14`, `publish-image.yml:61`). |
  | AC-4 the suite holds the rules | R0, M1, S14–S16 | The checkers find 11, 5 and 5 on the files as they were. A file added later is read (`test/workflow-hardening.test.js:78-84`). Its holes are non-blocking 1 to 3. |
  | AC-5 the docs | D1–D4 | The claim table below. All four clauses are in OPERATIONS.md. D1, D2 and D4 match §17's own heading first, so they read the whole section; the text each needs is in the right subsection. The `ninja` box's own setup doc was missed (B1). |
  | AC-6 nothing else | the existing W-handles; V2 | The parsed comparison, above. V3 is for the pull request and after (B2). |

- [x] **No criterion is silently dropped.**
- [x] **No behavior added that isn't in the story.** The four Deviations (story `:91-101`) are each acceptable:
  - **`permissions: {}` on the deploy workflows.** The action needs no token, as its source at the pin shows.
  - **A comment on each added line.** Each comment is accurate, and the parsed comparison shows they change nothing.
  - **"§6.3 step 2" became "step 3".** Right: step 3 is the deploy key (`OPERATIONS.md:229`); step 2 is SSH hardening.
  - **The full gate was not run on the development machine.** Right for that machine. What the pull request's run will say is B2.

## OPERATIONS.md §17 and the changed §6.2, claim by claim

| Claim | Where | Checked against | Result |
|---|---|---|---|
| The guard reads the folder on every `npm test`, names the file and the rule, and covers a workflow added later | `:1106` | `test/registry.js:161`; `test/workflow-hardening.test.js:78-87`; S15, S16 | Holds |
| The example pin | `:1113` | V1 | Holds |
| A tag can be moved and a commit id can't | `:1116` | How git works. No source read today. | Holds |
| `appleboy/ssh-action` downloads its SSH client from a release at run time | `:1116` | `entrypoint.sh` at the pin: `curl` fetches `drone-ssh` 1.8.2 from a release of `appleboy/drone-ssh`, with no checksum | Holds (non-blocking 7) |
| How to read a pin with `git ls-remote`, and which line is the commit | `:1118-1124` | The same command gave the six V1 reads. All six were the "otherwise the plain line is" case. The `^{}` case is git's behaviour for annotated tags, not seen today. | Holds. The example's `v1.2.6` does not exist (non-blocking 5). |
| `test/ci-test-job.test.js` holds the gate's two actions at `v5` | `:1124` | W3 `:94`, W4 `:104` | Holds |
| Which workflow declares what | `:1128-1134` | The seven files | Holds |
| Without a declaration, a repository setting decides | `:1128` | GitHub's behaviour as I know it. Not read today. | Not re-verified |
| The table of environments, secrets, workflows and branches | `:1140-1146` | Each file's `on:` and secrets; `publish-image.yml:58` for `ninja`'s two branches | Holds for this tree. One more workflow reads `magic-carpet`'s secrets on another branch (non-blocking 4). |
| A repository-level secret goes to any workflow that names it, on any branch | `:1148` | GitHub's behaviour as I know it. Pull requests from forks are the exception. | Not re-verified |
| An environment's secrets go only to a job that names it, and only from the branches it allows | `:1148` | Documentation `manage-environments.md:82`: "These secrets are only available to workflow jobs that use the environment. Additionally, workflow jobs that use this environment can only access these secrets after any configured rules (for example, required reviewers) pass." A branch limit is one of those rules, by my reading (`:74-75` are its settings steps). | Holds. The option is labelled "Selected branches and tags" (non-blocking 5). |
| Required reviewers | `:1148` | Documentation `:59-60` | Holds |
| GitHub creates an environment the first time a job names it, empty and with no rules | `:1150` | Documentation `:95`, quoted above | Holds |
| Until its secrets are added, the job reads the repository-level secrets of the same names | `:1150` | Documentation `secrets.md:25`, quoted above: a job that names an environment sees both levels | Holds. The first deploy to staging is the live proof. |
| The order for moving a target's secrets | `:1152-1160` | Follows from the two rows above, and from each push-triggered workflow running its own branch's copy. Step 1's command, run as written on my local refs, prints nothing for the four deploy branches today and prints the line for this branch's five files. "§6.3 step 3" is the key step (`:229`). | Holds where one workflow reads a target's secrets (non-blocking 4) |
| GitHub can't copy a secret's value | `:1156` | GitHub's behaviour as I know it | Not re-verified |
| §6.2 steps 1 and 2, §6.3's last line, §1 and §3 | `:188-189`, `:235`, `:45`, `:100` | Consistent with §17. "`npm test` fails without it" is R4. The four in-page links this diff adds resolve. | Holds |

## ADR adherence

Not applicable. The owner skipped Architecture at intake, as obvious for a Bug. The convention is recorded in OPERATIONS.md §17.

## Concept-graph integrity

- [x] **Handles:** none touched.
- [x] **Firmware reinstall:** not needed. No concept changed.
- [x] **`/summaries`:** not applicable. This is CI configuration.

## Things tests can't catch

- [x] **No secrets in committed files.** In the added lines, the only IP address is one already in the sentence this diff edits (`OPERATIONS.md:45`), and the only 40-character hex strings are the six pins. There is no 64-character hex string, key, token or home path.
- [x] **Described, not named.** The diff's files describe the exposure at the level of the story's Background: where deploy secrets live, and how GitHub hands them out. I saw nothing more specific.
- [x] **No leftover debug logging.** The guard's only `console.log` is the suites' usual result printer (`test/workflow-hardening.test.js:642-646`).
- [x] **No commented-out code.**
- [ ] **Error paths and edge cases.** A file the guard can't parse is a finding, not a silent pass (S14). Its holes are non-blocking 1 to 3.
- [x] **Concurrency.** Not involved. S16 writes to a temporary folder of its own and removes it.
- [ ] **Security.** The change narrows what each workflow can reach. One operator doc still points the other way (B1).

## House rules check

- [x] **Concept Graph API authority:** not involved.
- [x] **No new lint, typecheck or build tooling.** The guard is a test suite on `js-yaml`, already a dependency. No package file changed.
- [x] **The harness-definition rule.** `.github/workflows` changed, and the same commit adds an accurate row at `engineering-team/CHANGELOG.md:118`. The date at `OPERATIONS.md:6` moved with the content.
- [x] **No TA pubkey literal** added, and the `LEGACY_*` constants are untouched.

## Product-guide adherence *(when the story traces to a PRD)*

Not applicable. The book has an acceptance frame and no PRD, and there is no UI.

## Findings

### Blocking

1. **B1. `deploy/RUNBOOK.md:125-131`: the `ninja` box's setup still puts its deploy key at repository level.**
   - **What it says.** Step 7 has an admin add `DEPLOY_HOST_NINJA`, `DEPLOY_USER_NINJA` and `DEPLOY_SSH_KEY_NINJA` "In the repo's Settings, Secrets and variables, Actions" (`:130`). That is the page for repository secrets.
   - **What this change says.** `publish-image.yml:61` names the `ninja` environment, and §17.3 says a deploy target's `DEPLOY_` secrets belong in its environment (`OPERATIONS.md:1148`), with `ninja` in its table (`:1146`). The diff rewrote §6.2 for droplets (`:188-189`). But §6 sends the `ninja` box to the runbook (`:176`), which this diff does not touch and which has no pointer to §17.
   - **Why it blocks.** Step 7 is what an admin follows to set the box up again or to give it a new key, and §17.3 step 3 itself suggests a new key during the move (`:1156`). Followed after the move, it puts the new key where §17.3 says a workflow on any branch can read it. The job never uses that key either, because the environment's older value takes precedence. The guard can't see any of this: the workflow still names its environment.
   - **Asked change.** In step 7, the three secrets go in the `ninja` environment (Settings → Environments), limited to `staging` and `main` as the table says, with a pointer to OPERATIONS.md §17.3. A pointer the other way, from §17.3's last line (`:1162`) to the runbook, would close the loop. A Markdown change under `deploy/` does not roll the brains (`publish-image.yml:40`).

2. **B2. Test plan `:95` and `:132-133`: the run named as this story's full gate is expected to come back red, and the plan says it must be green.**
   - **What the plan says.** The full gate's result comes "From the pull request's `Test` run" (`:95`), and V3 says that run "must be green" (`:132-133`). The story's fourth Deviation rests on the same sentence (`:99-101`).
   - **What the tree says.**
     - `ledger/2026-11-07-reading-writeverbs-raw-publish.md` is OPEN: "Until it's fixed, every PR into `staging` reads red on this one test" (`:15`).
     - The cause is still here at `0af83004`. `ui/src/pages/reading/writeVerbs.js:278` posts to `/api/strfry/publish` by hand, and `RAW_PUBLISH_ALLOWED` (`test/setup-alert-polish.test.js:42-52`) doesn't list that file. So S2 (`:358`) fails with or without a stack.
     - I did not run that suite. The baseline record named above has it at 16 passed, 1 failed.
   - **Why it blocks.** That run is the only full-gate evidence this story will have. As written, V3 fails for a reason that has nothing to do with the change, and the story would be marked Done against a gate that reads FAIL. The ledger row records that an earlier book shipped with this red "on the owner's OK". That is the owner's to give again. A review can't assume it.
   - **Asked change, one of:**
     - the fix for S2 lands on `staging` first (the row gives its shape), and V3 stands as written; or
     - the Tester amends `:95-98` and V3 to name the known failure and to say how the run is read, and the owner's OK to ship on that reading is recorded. For example: every step before `npm test` succeeds on the pinned actions with `contents: read`, and the run's only failure is `setup-alert-polish` S2.

### Non-blocking

1. **`test/workflow-hardening.test.js:209-222`: ENV misses a fourth way to read every secret.**
   - S13 (`:438-452`) catches `toJSON(secrets)`, `secrets[…]` and `secrets: inherit`. GitHub's expressions also have an object filter, `secrets.*`, which gives every secret's value.
   - In a probe, a job with no `environment:` that reads `join(secrets.*, …)` or `toJSON(secrets.*)` passed the guard, while the two controls (a named deploy secret, and `toJSON(secrets)`) were caught.
   - A space around the dot (`secrets . DEPLOY_SSH_KEY_STAGING`) passed too. I believe GitHub's parser accepts that, but couldn't test it here.
   - Why it doesn't block: nobody writes these by accident, and the guard is a tripwire, not the control. The control is each environment's branch limit in GitHub.
   - Suggested (Tester): treat any use of `secrets` that isn't `secrets.<NAME>` as reading every secret, with these as S13 cases. Or list them under the test plan's "Not covered" (`:66-73`).

2. **`test/workflow-hardening.test.js:102-131`: PIN reads only the `uses:` lines of workflow files.** Two things a workflow can run are outside it:
   - a local action (`uses: ./…`) is passed unread (`:115`, `:125`; S1 `:344`), though its own `action.yml` is in this repo and can call other actions by tag;
   - a job's `container:` or `services:` image named by tag, while an image run as a step is held to a digest (`:126-131`).

   Probes confirm both pass. Nothing uses either today: no `action.yml` is tracked, and no workflow has `container:` or `services:`. Suggested (Tester): hold both, or name them under "Not covered".

3. **`OPERATIONS.md:1118-1124`: whether a pin is the release it claims is checked once, in this review.** The guard checks the form: 40 hex characters and a `# vX.Y.Z` comment. In a probe, any id with any version comment passed. The test plan says so (`:70`), and V1 covered this change. Nothing asks the reviewer of the next pin move to read it again. Suggested: one sentence in §17.1, that the reviewer of a pin change runs the same `git ls-remote` and compares.

4. **`OPERATIONS.md:1154` and `:1158`, and the epic `:39-41`: the move order and the landing note assume one workflow per target.**
   - On `feature-magic-carpet` the folder holds `configure-prod.yml`, `deploy-brainstorm.yml` and `deploy-magic-carpet.yml`. This is my local ref, `08376328` of 2026-11-02. I did not fetch.
   - `configure-prod.yml`, run by hand, also reads `DEPLOY_*_MAGIC_CARPET`. It calls `appleboy/ssh-action@v1.2.2`, and has no `permissions:` and no `environment:`. It is the only such extra workflow on any of the 39 remote branches I have.
   - So after step 5 for `magic-carpet`, that workflow finds no secret unless it names the environment too.
   - And when this change reaches that branch, the guard fails on both extra files. The branch is 4,245 commits behind `staging`, so "the usual promotion and sync" is not a small step.
   - Suggested: step 1 checks every workflow on the branch that names the target's secrets (`git grep -n 'DEPLOY_[A-Z_]*_<NAME>' origin/<branch> -- .github/workflows`), and the book's "What stays open" (`engineering-team/audits/workflow-hardening/book.md:28`) names the two files.

5. **Small wording points in OPERATIONS.md.**
   - `:189` and `:1148`: GitHub's option reads "Selected branches and tags".
   - `:1121`: `v1.2.6` does not exist. The newest `v1.*` is `v1.2.5`, so the command as printed returns nothing. Using `v1.2.5` would let a reader compare the output with the pin shown above it.
   - `:1148`: a branch limit is as strong as the rules on the branch it allows, and §4 (`:106`) records what those are. One sentence pointing there would keep "limited to its deploy branch" from reading as more than it is.
   - `:15`, older than this diff: the contents line links `#4-branch-protection-ruleset`, but the heading (`:104`) ends "rulesets". The new link at `:1128` is right.

6. **Test plan `:129`: V2's command has two blind spots.**
   - Its first `grep` drops any changed line whose text starts with `-` or `+` in the first column.
   - Any changed `uses:` line passes, whatever it now names.

   Neither one bit here: the parsed comparison covers both. Suggested: say so beside the command, or pair the removed and added `uses:` lines by action name.

7. **`OPERATIONS.md:1116`, and the SSH step of all five deploy jobs: the step that holds the SSH key still runs a program fetched at run time.** At the pin, `entrypoint.sh` downloads `drone-ssh` 1.8.2 from a release of another repository, with `curl` and no checksum. §17.1 says this accurately. Worth an intake entry: a plain `ssh` step on the runner would need neither the action nor the download.

8. **Three older citations of `test.yml:36` now point at the Node setup line.** They are `test/honest-publish-reporting-ci-guard.test.js:13`, `engineering-team/decisions/honest-test-gate/0001-registry-runner-and-run-record.md:64` and `engineering-team/stories/honest-publish-reporting/1-publish-result-tells-the-truth.test-plan.md:134`. `npm ci` and `npm test` are at `:40-41` now. Only the comment in the test is worth correcting, and that file is the Tester's.

### Harness friction *(each becomes an OPEN.md row, type `meta`)*

1. **The Reviewer role, workflow 5 and the review template all say to run `npm test`, and none says what a full run does to a stack that answers.** Already tracked: `ledger/2026-11-13-live-suites-have-no-off-switch.md`, this story's own row, and OPEN.md row 294. This review is another case of row 294's "no full run at all". Add it there; no new row.
2. **The template's `## On PASS (same commit)` heading comes after the verdict and carries a verdict word,** so a review written to the template that requests changes lints as a pass. Already tracked: `ledger/2026-10-07-on-pass-heading-reads-as-verdict.md`. I moved the section above the verdict by hand. One more occurrence for that row.
3. **`scripts/harness-def-paths.txt:16-18` says the workflows are retired and "no workflow runs".** This story exists because they run. Already tracked: `ledger/2026-10-29-h2-0-baseline-predates-github-flow.md`, item 3 of its fix list. That row places the comment on `main`; it is in this branch's tree too.
4. **New: nothing in Test Design asks whether a registered suite is already red before a test plan names CI as its gate** (B2). The row for the red suite has been OPEN since 2026-11-07, and says what every pull request into `staging` will show. Candidate: workflow 3 checks the OPEN `bug` rows that name a failing suite whenever a plan takes its gate from CI. Or a note on that row.
5. **New: Planning counted "every workflow" from one branch's folder** (non-blocking 4). `scripts/long-lived-branches.txt` lists the branches a change like this has to hold on. Candidate: a story about every file of one kind lists that kind on each long-lived branch at intake.

## On PASS (same commit)

- [ ] Not applicable: the verdict is CHANGES_REQUESTED.
  - The story's `**Status:**` stays `Approved`, and no completion detection was run.
  - Next round: the Implementer changes the runbook (B1). For B2, either the S2 fix lands first or the Tester amends the test plan and the owner's OK is recorded. Non-blocking 1 and 2 are the Tester's, if taken in the same round. Then this review re-derives the changed lines, runs the three suites again (D1 to D4 read OPERATIONS.md) and runs the lint.
  - The optional independent check (workflow 5) is the launching session's to apply before it commits this file. This session commits nothing.

## Verdict

**CHANGES_REQUESTED**

---

# Round 2

**Reviewer:** Claude (acting as Reviewer)
**Date:** 2026-11-13
**Diff:** `git diff 0af83004..28d402fe`, commit by commit:
- `0b5c3b71`: round 1 of this review, committed as written.
- `cc61d30f`: the Tester's round. The guard's two ENV patterns with four new cases in S11 and S13, one comment in `test/honest-publish-reporting-ci-guard.test.js`, and the test plan. It touches no workflow and no operator doc.
- `2ce462c2`: the fix. `deploy/RUNBOOK.md`, OPERATIONS.md, the book and the epic. It touches no `test/` and no workflow.
- `28d402fe`: records. Two new ledger rows, a dated note on two existing rows, and an intake entry.

**In short.** Both of round 1's blockers are answered, and every non-blocking item was taken or queued. Each fix holds when re-derived, with small leftovers listed below. One new thing blocks, and it comes from outside the branch: `staging` moved while this was in review. Its new tip adds its own section 17 to OPERATIONS.md at the same two places as this branch's. So the branch no longer merges, and its section number is taken (R2-B1).

On the question put to this round: the amended test plan answers B2, and a verdict does not have to wait for the owner's OK. The reasons are under "B2" below.

## Quality gates (run by reviewer, not trusted)

- [ ] **`npm test`: not run,** for round 1's reason. There is still no full-gate result for this code, and no `gate:status` line to quote.
- [x] **The same three suites, one at a time,** at `28d402fe`, on Node 24.18.0, with the same three variables pointed at nothing. They ran on this branch's tree, not on a merge with `staging`'s new tip (R2-B1).

  | Suite | Passed / failed / skipped |
  |---|---|
  | `workflow-hardening` | 26 / 0 |
  | `ci-test-job` | 14 / 0 |
  | `brains-launcher-repo` | 31 / 0 / 0 |

- [x] **`bash scripts/harness-lint.sh`:** clean, 0 violations, before this round was written and after.
- [x] **Lanes.** `git show --name-only` for `2ce462c2` and for `28d402fe` lists nothing under `test/`. No workflow file has changed since `0af83004`, so V1 and round 1's parsed comparison stand.
- [x] **V2's two commands, as the plan now gives them** (`:146`, `:154`). The first prints nothing. The second pairs every action: `actions/checkout` 2 and 2, `actions/setup-node` 1 and 1, `appleboy/ssh-action` 5 and 5, `docker/build-push-action` 2 and 2, `docker/login-action` 1 and 1, `docker/setup-buildx-action` 1 and 1.
- [x] **Probes,** in a throwaway `node -e`, with nothing written: the amended checkers on made-up workflows, and on the text of the two extra workflow files of `feature-magic-carpet`.
- [x] **The repo's own readers, by hand.** `intake_entries` reads the new intake entry as open, and `collect_meta` exits 0 and lists this story's three rows. Both only read files (`scripts/lib/collect-intake.sh`, `scripts/lib/collect-meta.sh`).
- [x] **GitHub, read only: four requests,** one at a time.
  - `git ls-remote origin` for three refs: `feature-magic-carpet`, `staging`, and pull request 51's.
  - The compare of this branch's base with `staging`'s tip, as a diff. I printed its file list, and the hunks of the files this branch also changes.
  - `ui/src/pages/reading/writeVerbs.js` at `staging`'s tip, for the lines that name the publish route.
  - The pin command, exactly as `OPERATIONS.md:1121` prints it.
- [ ] `npm run test:playwright`: not applicable (no UI).
- [ ] _Lint, typecheck and build not configured — skipped._

## Round 1's findings, each re-derived as a fresh claim

| Finding | Re-derived by | Result |
|---|---|---|
| B1, the runbook | `deploy/RUNBOOK.md:130-135` sends the three secrets to the `ninja` environment, "not to the repository's own secrets", and points at §17.3. `OPERATIONS.md:1169` points back, and "step 7 of Handover 1" is right (`deploy/RUNBOOK.md:59`, `:125`). Both links resolve. The case round 1 blocked on can no longer come from following the text: after the move the environment exists and is limited (`OPERATIONS.md:1162`), so a new key lands in a limited environment. | Fixed. One wording gap (non-blocking 1). |
| B2, the run named as the gate | Test plan `:109-115` and `:159-160`, checked against `staging`'s tip. | Answered. See "B2" below. |
| Non-blocking 1, the object filter | `test/workflow-hardening.test.js:209`, `:212`; S11 `:432-433`; S13 `:447-452`. In a probe, all four forms round 1 reported are caught: `join(secrets.*, …)`, `toJSON(secrets.*)`, the same beside a rightly named environment, and spaces round the dot. The plan puts the rest of the class under "Not covered" (`:81-82`). | Fixed for what was reported. Two leftovers (non-blocking 2 and 3). |
| Non-blocking 2, what PIN reads | Test plan `:78-80` names both under "Not covered", and the intake entry queues the choice. It is still true that nothing uses either. | Recorded, as round 1 offered. |
| Non-blocking 3, a pin's truth | `OPERATIONS.md:1124` asks whoever reviews a pin change to run the command and compare. | Fixed. |
| Non-blocking 4, one workflow per target | `OPERATIONS.md:1154-1161`, the book `:35-38`, the epic `:41-42`. The claim table below has the detail. | Fixed. |
| Non-blocking 5, wording | The label at `:189` and `:1148`; the example at `:1121`; the sentence on branch rules at `:1148`; the contents line at `:15`, which now resolves. | Fixed. One new phrase overstates §4 (non-blocking 4). |
| Non-blocking 6, V2 | Test plan `:149-157`. Both commands run as written (above). | Fixed. |
| Non-blocking 7, the run-time download | `engineering-team/stories/_intake.md:3007-3035`. It matches the action's source as read in round 1. Its added item holds too: the action has a `fingerprint` input, and no workflow sets one. | Queued. |
| Non-blocking 8, a stale line number | `test/honest-publish-reporting-ci-guard.test.js:13` names the step. It is a comment, and that suite does not read its own source. The two records keep their line numbers, as records. | Fixed. |
| Friction 1 | No note was added to OPEN.md row 294. The story's own row covers this machine. | Not taken. Optional. |
| Friction 2 | `ledger/2026-10-07-on-pass-heading-reads-as-verdict.md:38-40`. "Seven" follows the six before it. | Filed; accurate. |
| Friction 3 | `ledger/2026-10-29-h2-0-baseline-predates-github-flow.md:71-73`. The comment is on both branches, by my local refs. | Filed. One number unchecked (non-blocking 5). |
| Friction 4 | `ledger/2026-11-13-plan-names-ci-gate-already-red.md`. The lint and `collect_meta` read it. | Filed. One clause is off (non-blocking 6). |
| Friction 5 | `ledger/2026-11-13-story-counts-files-from-one-branch.md`. | Filed; its claims hold. |

## B2: is it answered, and does a verdict wait for the owner's OK?

**The amendment** (test plan `:109-115`, and V3 at `:159-160`). It names the red suite and its row, and gives two readings. If the fix for S2 is on `staging` when the pull request's run starts, the run must be green. If not, the run counts when every step before `npm test` succeeds on the pinned actions and S2 is the only failure, and "Shipping on that reading needs the owner's OK, recorded in the review".

**It is accurate, checked against `staging` as it is now** (it has moved: R2-B1):

- `test/setup-alert-polish.test.js` is not among the 92 files `staging` gained, so its allow-list is unchanged there.
- `ui/src/pages/reading/writeVerbs.js` at `staging`'s tip still posts to `/api/strfry/publish` by hand (`:278`).

So S2 is still red on `staging`, and the fix has not landed. "When this pull request's run starts" is the right test. A pull request's run is made from a merge with `staging` at that moment, and re-running the same run later reuses that merge. So a fix that lands afterwards needs a new push, not a re-run. That last part is GitHub's behaviour as I know it.

**The pull request that holds the fix (51).** No committed file names it, so nothing in the diff rests on it. Its head and merge refs exist on the remote. I did not read its content.

**Does a verdict wait for the owner's OK? No.** Round 1 asked for the OK to be "recorded" as part of the fix. Re-derived, that asked for it too early, and I withdraw that part:

- A verdict needs the plan to be true, and it needs nothing to ship on a red run on a review's say-so. The amended plan gives both.
- The OK is about one run's result, and that run exists only once the pull request does. The last book that met this red took it in that order: the run came back with S2 as its one failure, and then "The owner chose to ship with it" (`engineering-team/audits/openapi-coverage/audit.md:86-88`).
- So a pass in a later round is not that OK, and must not be read as one. If the run is red, the OK goes into this file before the merge: which run, that S2 was its only failure, that every step before `npm test` succeeded, and the owner's words and date. Put it above the last verdict, or keep verdict words off its bold and heading lines, so the lint still reads the right one.

## The new sentences, claim by claim

| Claim | Where | Checked against | Result |
|---|---|---|---|
| The `ninja` secrets go in the `ninja` environment, limited to `staging` and `main`, and the publish workflow names it | `deploy/RUNBOOK.md:130-135` | `publish-image.yml:58`, `:61`; `OPERATIONS.md:1146` | Holds. The limit is written for the case where the environment has to be created (non-blocking 1). |
| GitHub's label, "Selected branches and tags" | `OPERATIONS.md:189`, `:1148`; `deploy/RUNBOOK.md:131` | Round 1's read of the documentation (`manage-environments.md:75`) | Holds for the option. The section's own name I can't see from here; the documentation's step calls the dropdown "Deployment branches". |
| For `v1.2.5` the command prints the pin shown above | `OPERATIONS.md:1121`, `:1124` | Run as printed. One line: `0ff4204d59e8e51228ff73bce53f80d53301dee2`, `refs/tags/v1.2.5`. | Holds |
| The test checks a pin's form, not that it is the release its comment names | `:1124` | `test/workflow-hardening.test.js:97-99`; round 1's probe | Holds |
| Whoever may push to the allowed branch can change the workflow that runs there | `:1148` | A push's run uses the workflow file of the pushed commit | Holds |
| §4 records what protects each branch | `:1148` | §4 itself (`:106`) | Overstated (non-blocking 4) |
| A run waits for a required approval, and the two cycle skills wait with it | `:1148` | The skills find the run by its commit, with no filter on its state, then call `gh run watch` with no bound (`.claude/skills/cycle-staging/SKILL.md:120-127`, `.claude/skills/cycle-prod/SKILL.md:113-120`). That `gh run watch` keeps watching a waiting run is as I know it; not run. | Holds, as far as the files show |
| Step 1's two commands | `:1154-1159` | Run as written on local refs. For `MAGIC_CARPET` on `feature-magic-carpet` the first lists `configure-prod.yml` and `deploy-magic-carpet.yml`. For the other targets on their own branches it lists one file each. The second lists no line on today's branches, and five on this one. | Holds |
| On 2026-11-13 `feature-magic-carpet` held two workflows that `staging` doesn't; both name deploy secrets, call their action by a tag, and declare no permissions or environment; the test fails on them | `:1161`; the book `:35-38`; the epic `:41-42` | The remote's tip today is `08376328`, the ref I read. In the files: `DEPLOY_*_MAGIC_CARPET` and `DEPLOY_*_BRAINSTORM`; `@v1.2.2` and `@v1`; no `permissions:` or `environment:` at any depth. The guard's checkers give each file three findings: PIN, TOKEN and ENV. | Holds, both claims |
| The `ninja` box's setup is step 7 of Handover 1 | `:1169` | `deploy/RUNBOOK.md:59`, `:125` | Holds |
| The object filter and spaces round the dot are caught; the rest of that class is not | test plan `:60-63`, `:81-82` | The suite and the probes | Holds, with two leftovers (non-blocking 2 and 3) |
| How the pull request's run is read | test plan `:109-115` | "B2", above | Holds |
| V2's two blind spots, and the pairing command | test plan `:149-157` | Run as written | Holds |

## Findings

### Blocking

1. **R2-B1. `OPERATIONS.md:28` and `:1104`: `staging` moved while this was in review, and its new tip takes section 17 at the same two places.**
   - **What I read.** One `git ls-remote origin` at 18:08 on 2026-11-13 gives `staging` as `e62a5f92`. This branch, round 1 and this round's commands all rest on the local ref, `6c57ec1f`, last fetched at 14:54.
   - **What landed.** The compare of the two, read once from GitHub: 92 files, the work of `graph-operations-foundation` #3. One of them is also changed here: OPERATIONS.md. There `staging` now adds a contents line "17. [Migrations — lifecycle migrate …]" after line 27, and a section "## 17. Migrations — lifecycle migrate (graph-operations-foundation #3 / ADR graph-operations-foundation/0003)" at the end of the file. Those are the two places where this branch adds its own (`:28`, `:1104`), from the same base file.
   - **Why it blocks.**
     - The branch no longer merges into `staging`. Two different insertions at one place are a conflict, and there are two such places. I reasoned this from the two diffs; I did not fetch to try it.
     - GitHub does not run a pull request's workflows while it has a conflict. So V3's run cannot start. This is GitHub's documented behaviour as I know it, not re-read today.
     - Section 17 is taken, so this branch's section has to become 18. That changes lines this review has read: ten comment lines in six workflow files, the contents line, four headings and three links in OPERATIONS.md, the runbook's link, the story's Deviation, the CHANGELOG row and the intake entry.
     - The three suites and the lint ran on this branch's tree, not on a merge with the new tip.
   - **It is not a fault in the change,** which was right when written. Nothing else that `staging` gained touches this story's files: no workflow, not `test/registry.js`, not the CHANGELOG, not the runbook, and its two new ledger rows have other names.
   - **Asked change.**
     - Fetch, and merge `staging` into the branch or rebase onto it. In OPERATIONS.md, Migrations stays 17 and this section becomes 18, with 18.1 to 18.3.
     - Change every reference. On this branch today they are: `.github/workflows/deploy-magic-carpet.yml:7,13`, `deploy-staging.yml:15,21`, `deploy-tags.yml:7,13`, `deploy-tapestry.yml:12,18`, `publish-image.yml:60`, `test.yml:19`; `OPERATIONS.md:28,45,100,188,1104,1108,1126,1136`; `deploy/RUNBOOK.md:134`; `engineering-team/CHANGELOG.md:118`; `engineering-team/stories/_intake.md:3022`; and the story `:95`.
     - Optional: have the workflow comments and the runbook name the section by its title, not its number. A number is the second citation in this story to go stale; a line number was the first (round 1, non-blocking 8).
     - Then run V2's two commands again, since the workflow files change, and the three suites and the lint, all on the merged tree. The next round re-derives the changed lines.

### Non-blocking

1. **`deploy/RUNBOOK.md:130-131`: the branch limit is written only for the case where the environment has to be created.** "If it isn't there, create it, and under Deployment branches and tags choose …" After this change GitHub will have made `ninja` itself, empty and with no rules (`OPERATIONS.md:1150`). So the likelier case is the one the sentence skips. Suggested: "open the `ninja` environment, or create it. Either way, see that Deployment branches and tags is set to Selected branches and tags, with `staging` and `main`, before adding the secrets."

2. **`test/workflow-hardening.test.js:216` and `:222`: a line break or a tab round the dot still passes.**
   - The two patterns (`:209`, `:212`) run on the job as JSON text. There a line break inside a script is the two characters `\n`, which `\s*` does not match.
   - In a probe, `secrets`, a line break, then `.DEPLOY_SSH_KEY_STAGING` inside a `run: |` block passed, and so did the same with `.*`. The same break in a plain value was caught, because YAML folds it into a space.
   - Whether GitHub accepts a line break there, I couldn't test. The plan's "with spaces round the dot" (`:63`) is true as worded.
   - Suggested: match on the strings themselves, or add this beside the plan's `:81-82`.

3. **`test/workflow-hardening.test.js:212`: the new pattern also fires on ordinary script text.** In a probe, `rm -f config/secrets.*` and a `grep` for `secrets.*key` were each reported as reading every secret. It is a false alarm, not a hole, and no workflow here trips it. The guard has always read script text (S10's third case). Suggested: one line in the test plan's edge cases, so whoever meets it knows why.

4. **`OPERATIONS.md:1148`: "§4 records what protects each branch" says more than §4 does.** §4 gives the rulesets' definitions, says none has been in force since the move, and ends "Read the live settings, not this section, for what is enforced today" (`:106`). Suggested: "§4 says what is meant to protect each branch, and where to read what does."

5. **`ledger/2026-10-29-h2-0-baseline-predates-github-flow.md:72`: "They ran 143 times between 2026-10-27 and 2026-11-13" is a number I could not check.** It needs GitHub's list of runs, which I did not read. Suggested: say how it was counted, or drop the number. The sentence stands without it.

6. **`ledger/2026-11-13-plan-names-ci-gate-already-red.md:15`: "the Reviewer caught it by reading the ledger" is not quite how it went.** The Test Design baseline's own run record showed `setup-alert-polish` at 16 passed, 1 failed (round 1, Quality gates), and the ledger row then explained it. That bears on the fix shape: the Tester's own baseline already showed this red, as one of eighteen failing suites on a machine with a live stack. Suggested: say so, and consider a third fix shape, that a plan accounts for each failure in its baseline.

7. **The story `:91-101`: the Deviations don't mention the runbook,** a file the story never named, changed in `2ce462c2`. One line would keep the story's own record whole for the book's close (`engineering-team/roles/implementer.md:47`).

### Harness friction *(each becomes an OPEN.md row, type `meta`)*

1. **Review has no check of where the target branch is now.**
   - Workflows 1 and 2 start with an origin-drift preflight (`engineering-team/workflows/1-planning.md:16`, `2-architecture.md:16`). Workflow 5 has none, and this story skipped Architecture.
   - Round 1 compared against the local ref and did not ask the remote. I should have, with one of the reads I had. Whether `staging` had already moved by then, I can't tell.
   - It is close to `ledger/2026-10-14-session-start-stale-clone-unflagged.md`, whose fix shape is to run the preflight earlier. This is the case for running it later too. The clash itself is the kind `ledger/2026-11-08-parallel-stories-clash-in-shared-files.md` records: two branches each took the next section number of one shared file on the same day.
   - Candidate: workflow 5 reads the target's tip (`git ls-remote`, which writes nothing) and names it in the review's Diff line. A note on the first of those rows, or a new row.

## On PASS (same commit)

- [ ] Not applicable: the round-2 verdict is CHANGES_REQUESTED.
  - The story's `**Status:**` stays `Approved`, and no completion detection was run.
  - Round 3: the branch takes in `staging`, the section becomes 18 and its references follow (R2-B1). Non-blocking 1 to 7 are small and can ride along. Then this review reads the target's tip again, re-derives the changed lines, and re-runs V2's two commands, the three suites and the lint on the merged tree.
  - The owner's OK for a red run is not part of round 3 (see "B2").
  - This session commits nothing.

## Verdict (round 2)

**CHANGES_REQUESTED**

---

# Round 3

**Reviewer:** Claude (acting as Reviewer)
**Date:** 2026-11-13
**Target:** `staging` on the remote is `e62a5f92`, read with one `git ls-remote origin refs/heads/staging` at 18:25. The local ref is the same commit, and it is an ancestor of HEAD.
**Diff:** `git diff 28d402fe..2d638684`, commit by commit:
- `3336b8f4`: round 2 of this review, committed as written.
- `99acd2e3`: the merge of `staging` at `e62a5f92`. One file was resolved by hand, OPERATIONS.md.
- `44fbcc52`: the Tester's round. The guard's ENV reader, one new case in S10 and three in S13, and the test plan. It touches no workflow and no operator doc.
- `e596b6de`: the fix. Ten comment lines in six workflow files, one sentence of OPERATIONS.md, the runbook, the CHANGELOG row, the intake entry and the story. It touches no `test/`.
- `2d638684`: records. One new ledger row, and two rows corrected.

**In short.** R2-B1 is fixed. The branch holds `staging`'s tip, the merge lost nothing of either side, and this story's section is 18 wherever it is named. All seven of round 2's non-blocking items were taken, and each holds when re-derived. Nothing blocks. The guard's rewrite opened two small gaps, of the kind the earlier rounds did not block on (non-blocking 1 and 2).

Two things this verdict is not. It is not a full-gate result: that comes from the pull request's `Test` run. And it is not the owner's OK for a red run (round 2, "B2").

## Quality gates (run by reviewer, not trusted)

- [ ] **`npm test`: not run,** for round 1's reason. There is still no full-gate result for this code, and no `gate:status` line to quote. The pull request's `Test` run will be the first, read as the test plan says (`:111-119`).
- [x] **The same three suites, one at a time,** on the merged tree at `2d638684`, on Node 24.18.0, with the same three variables pointed at nothing.

  | Suite | Passed / failed / skipped |
  |---|---|
  | `workflow-hardening` | 26 / 0 |
  | `ci-test-job` | 14 / 0 |
  | `brains-launcher-repo` | 31 / 0 / 0 |

- [x] **`bash scripts/harness-lint.sh`:** clean, 0 violations, before this round was written and after.
- [x] **Lanes.** `e596b6de` and `2d638684` touch nothing under `test/`. `44fbcc52` touches only `test/workflow-hardening.test.js` and the test plan.
- [x] **V2's two commands against `origin/staging`,** now `e62a5f92` (test plan `:150`, `:158`). The first prints nothing, with 45 changed lines going in. The second pairs every action, with round 2's counts.
- [x] **The workflows, parsed.** All seven are equal to `staging`'s apart from the three permitted kinds of change. Since round 2 only comments changed: 20 changed lines, each a comment, and each parsed document is identical to round 2's.
- [x] **The harness-definition rule.** `e596b6de` changes the workflow files and the CHANGELOG row together.
- [x] **Probes,** in a throwaway `node -e`, with nothing written: the rewritten ENV reader on made-up workflows.
- [x] **Other suites that read a changed file: read, not run.** Besides the guard and `ci-test-job`, nine suites open OPERATIONS.md on the merged tree. Each checks that words of its own section are present, and this branch changes none of those sections (see the corrections below).
- [x] **GitHub, read only: three requests,** one at a time.
  - `git ls-remote origin refs/heads/staging`.
  - The runner's copy of the workflow schema (`actions/runner`, `src/Sdk/DTPipelines/workflow-v1.0.json`), for values that are expressions without braces. It carries no such marker, so it settled nothing.
  - GitHub's template reader (`actions/runner`, `src/Sdk/DTObjectTemplating/ObjectTemplating/TemplateReader.cs`), for how it finds the end of an expression and how it treats one used as a mapping key.
- [ ] `npm run test:playwright`: not applicable (no UI).
- [ ] _Lint, typecheck and build not configured — skipped._

## Two corrections to earlier rounds (my own)

- **Round 1 said seven more suites open OPERATIONS.md. There were eight.** My search read `test/*.test.js` and missed a subfolder. `test/operations/lifecycle/backup-job.test.js` was already on the old base. Its K3 (`:539-547`) checks that the Backups section's own words are present, so round 1's conclusion stands. The merged tree has a ninth, `test/operations/lifecycle/tapestry-key-paths.test.js` G13 (`:425-427`), which checks that `staging`'s section 17 names its two migrations. It does: that section is untouched.
- **Round 2 could not tell whether `staging` had already moved during round 1. It had.** Its tip was committed at 15:46, and round 1 began after 17:00. So round 1 read a branch that could not merge, as the new ledger row says.

## The merge, `99acd2e3`

- **Its parents** are `3336b8f4`, this branch, and `e62a5f92`, `staging`. OPERATIONS.md is the only file that differs from both.
- **Everything else came across whole.** The other 91 files `staging` had changed are byte-identical to `staging`'s. The other 23 files this branch had changed are byte-identical to the branch's.
- **OPERATIONS.md, `staging`'s side.** Its section 17 (`:1103-1120`) is byte for byte `staging`'s, and so is its contents line (`:28`). No line that `staging` added is missing. Six lines of `staging`'s file are not in the merge, and all six are lines of the old base that this branch had itself rewritten: the date, the contents line for §4, the sentence in §1, two steps of §6.2 and one line of §6.3.
- **OPERATIONS.md, this branch's side.** Eight lines of the branch's file are not in the merge: the eight that carried the number 17. The merge has eight lines that neither parent has: the same eight with 18 (`:29`, `:46`, `:101`, `:189`, `:1124`, `:1128`, `:1146`, `:1156`).
- **Links.** Every relative link on a line this branch adds resolves: 15 of them, across 15 Markdown files. That includes the in-page links to `#18-workflow-rules-…`, `#183-deploy-environments`, `#62-github-setup` and `#4-branch-protection-rulesets`, and the runbook's link into OPERATIONS.md (`deploy/RUNBOOK.md:135`). No heading in OPERATIONS.md repeats another's anchor, and the contents entries 16 to 18 resolve.
- **No reference to this section as 17 is left,** outside this review's earlier rounds. Two files still say "OPERATIONS.md §17": `BIBLE.md:1940` and `engineering-team/decisions/graph-operations-foundation/0003-a-tapestry-key-on-every-node.md:321`. Both are `staging`'s own, both mean Migrations, and both are right because Migrations kept its number.

## Round 2's findings, each re-derived as a fresh claim

| Finding | Re-derived by | Result |
|---|---|---|
| R2-B1, `staging` moved | "The merge", above. The references round 2 listed all follow: the ten workflow comments now name the section by its title, and the runbook (`deploy/RUNBOOK.md:135`), the CHANGELOG row (`engineering-team/CHANGELOG.md:118`) and the intake entry (`engineering-team/stories/_intake.md:3022`) say 18. | Fixed. |
| Non-blocking 1, the runbook's branch limit | `deploy/RUNBOOK.md:130-132`: "open the `ninja` environment, or create it if it isn't there", then "Either way, under Deployment branches and tags choose Selected branches and tags, with `staging` and `main`." Its added sentence, that GitHub makes the environment empty with no rules on the first run, matches the documentation round 1 read. | Fixed. |
| Non-blocking 2, a line break or a tab round the dot | The reader now walks the parsed strings themselves (`test/workflow-hardening.test.js:215-229`). In a probe, a line break before the dot is caught for a named secret and for `.*`, and so is a tab. S13 holds the two line breaks (`:480-481`, `:484-486`). | Fixed. |
| Non-blocking 3, false alarms on script text | "Every secret" is looked for only inside `${{ … }}` and in `if:` (`:236-248`). In a probe, the `rm` and the `grep` are no longer findings, and S10 holds it (`:444-445`). What should still be caught is: an expression inside a script, a step's `if:`, a called workflow's `secrets:` map, a top-level `env:`, and the second of two expressions in one string. | Fixed. The rewrite opened two gaps (non-blocking 1 and 2). |
| Non-blocking 4, what §4 records | `OPERATIONS.md:1168`: "§4 describes the rulesets, and the live settings are what count." That is what §4 says of itself (`:107`). | Fixed. |
| Non-blocking 5, "143 runs" | `ledger/2026-10-29-h2-0-baseline-predates-github-flow.md:72-73` now says where the figure was read, and when. | Answered. The number itself I still can't check. |
| Non-blocking 6, how the red suite was caught | `ledger/2026-11-13-plan-names-ci-gate-already-red.md:15-16`. | Fixed. It matches what happened. |
| Non-blocking 7, the Deviations | The story `:104-108` names the runbook change and the merge, and `:95-97` says why the comments now name the section. | Fixed. |
| Friction, no check of the target | `ledger/2026-11-13-review-has-no-origin-drift-check.md`. Its 19 commits are right (`6c57ec1f..e62a5f92`). It calls the local ref "four hours old"; by the fetch log it was about three. Immaterial. | Filed; its claims hold. |

One sentence is new in the test plan and rests on my own round-2 words: "A re-run of an older run does not count: it tests the same merge of branch and base as the first time" (`:115-117`). It is GitHub's behaviour as I know it. I did not read it from a source this round, and nothing in the repo records it. If it were wrong, following it would cost one needless push.

## Does reading only expressions open a hole?

**Where GitHub evaluates an expression.** Inside `${{ … }}`, wherever that stands, and in `if:` without the braces. I know of no other place in a workflow file. That is GitHub's documented behaviour as I know it, and the one source I tried for it this round settled nothing. As I know it, `secrets` is not available to an `if:` at all, so reading `if:` errs on the safe side.

**What the scoping cannot hide.** A named deploy secret is still looked for in every string, not only inside expressions (`:226-229`). So a secret named in any value is seen, whatever surrounds it.

**What it does open.** Two things, both inside `${{ … }}`, and both checked against GitHub's own reader (non-blocking 1 and 2).

## Findings

### Blocking

None.

### Non-blocking

1. **`test/workflow-hardening.test.js:239`: the guard ends an expression at the first `}}`, and GitHub does not when that `}}` is inside a quoted string.**
   - GitHub's reader skips quoted strings as it looks for the end (`TemplateReader.cs:511-527`: it tracks `inString`).
   - In a probe, `${{ format('}}{0}', toJSON(secrets)) }}` passed, and so did the same shape with `join(secrets.*, …)`. The guard took ` format('` as the whole expression. Round 2's code caught both.
   - A named deploy secret after such a `}}` is still caught, because that check reads the whole string.

2. **`test/workflow-hardening.test.js:215-220`: mapping keys are no longer read.**
   - `stringsIn` collects values. Round 2's code searched the job as JSON text, which holds the keys too.
   - GitHub's reader accepts an expression as a key wherever the mapping may use a context (`TemplateReader.cs:187-195`, `:314-322`). I read the reader, not what the evaluator then does with such a key.
   - In a probe, an `env:` whose key is `${{ toJSON(secrets) }}` passed, and so did one whose key is `${{ secrets.DEPLOY_SSH_KEY_STAGING }}`.

   Why neither blocks: as in rounds 1 and 2, nobody writes these by accident, and the guard is a tripwire, not the control. Suggested (Tester), for both: have `stringsIn` yield each key as well, and look for the closing `}}` the way GitHub does, outside quoted strings. Failing that, name both under the test plan's "Not covered" (`:83-84`): its "The guard knows the four above" is not the whole truth for `toJSON(secrets)` in those two places.

3. **The story `:113`: "Review: (filled in after Review phase)" is still a placeholder.** I changed the status line only, as asked. Whoever commits this can fill it in.

### Harness friction *(each becomes an OPEN.md row, type `meta`)*

1. **New, and small: a later round is added to a file the Reviewer can only write whole.** The Reviewer has Write and no Edit, by design. So each round re-emits the earlier rounds, and the story's status line was changed by rewriting the story. I checked both with `git diff --numstat`: no line of rounds 1 and 2 changed, and the story's diff is its status line. Candidate: workflow 5 asks for that check whenever a round is added, or a later round goes in a file of its own.

## On PASS (same commit)

- [x] Story `**Status:**` flipped to `Done` in place. Line 3 only.
- [x] Completion detection performed. Its result is in the chat, not in this file.
- What this leaves open, for whoever opens the pull request:
  - V3: the pull request's `Test` run, read as the test plan says (`:111-119`); then the first `Deploy to Staging` run, and the brains' roll.
  - The owner's OK, recorded in this file above the last verdict, if that run is red on `setup-alert-polish` S2 alone (round 2, "B2").
  - `staging`'s tip, read once more before the pull request is opened. It was `e62a5f92` at 18:25.
- The optional independent check (workflow 5) is the launching session's to apply before it commits this file. This session commits nothing.

## Verdict (round 3)

**PASS**
