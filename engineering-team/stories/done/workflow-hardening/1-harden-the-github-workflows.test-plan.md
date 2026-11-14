# Test Plan: Story 1 — The GitHub workflows pin what they run, limit their token, and name a deploy environment

**Story:** `engineering-team/stories/workflow-hardening/1-harden-the-github-workflows.md`
**ADR:** none (Architecture skipped at intake, 2026-11-13)
**Date:** 2026-11-13

## Coverage map

The new suite is `test/workflow-hardening.test.js`. It reads every file in `.github/workflows/` from the directory,
so a workflow added later is checked without the suite being edited. Its three rules are named in every finding:
`PIN`, `TOKEN` and `ENV`.

| Criterion | Test name | Test file | Level |
|---|---|---|---|
| AC-1 | `R1: every action in every workflow is pinned to its full commit id, with its released version in a comment` | `test/workflow-hardening.test.js` | source contract |
| AC-1 | `S1`–`S4`: the PIN checker passes a commit pin with a release comment, and catches a tag, a branch, a short id, an image tag, a missing or vague comment, and a reusable workflow called by a tag | `test/workflow-hardening.test.js` | unit |
| AC-1 | `W3`, `W4`, `W9`, amended: the test gate's two actions are named by commit id, with a `# v5.x.y` comment | `test/ci-test-job.test.js` | source contract |
| AC-1 | `V1`: each pin is the commit its former tag pointed to (procedural, below) | — | at review |
| AC-2 | `R2: every workflow declares what its token may do, none can write repository contents, and every write scope is listed` | `test/workflow-hardening.test.js` | source contract |
| AC-2 | `R3: WRITE_SCOPES lists no file that is gone, and no scope its workflow no longer asks for` | `test/workflow-hardening.test.js` | source contract |
| AC-2 | `S5`–`S8`: the TOKEN checker passes read-only and empty declarations, and catches a missing or empty one, `contents: write` at either level, `write-all`, and an unlisted write scope | `test/workflow-hardening.test.js` | unit |
| AC-3 | `R4: every job that reads a deploy secret names that server's environment` | `test/workflow-hardening.test.js` | source contract |
| AC-3 | `S9`–`S13b`: the ENV checker passes the right environment in either form, asks nothing of a job with no deploy secret, and catches a missing, wrong or computed name, two servers in one job, and secrets read without being named | `test/workflow-hardening.test.js` | unit |
| AC-4 | `S14`–`S16`: an unreadable file is a finding; every finding starts with its file and rule; a file added to the folder later is read, `.yml` or `.yaml` | `test/workflow-hardening.test.js` | unit |
| AC-4 | `M1: each real workflow, broken in memory one rule at a time, is caught` | `test/workflow-hardening.test.js` | source contract |
| AC-4 | `R0: the guard reads every workflow file in .github/workflows/, and there is at least one` | `test/workflow-hardening.test.js` | source contract |
| AC-5 | `D1`–`D4`: OPERATIONS.md says deploy secrets belong in the target's environment, limited to its deploy branch; gives the order for moving an existing target's secrets; has the new-target setup create the environment; and says how to move a pin | `test/workflow-hardening.test.js` | source contract |
| AC-6 | Existing, unchanged: `W1`, `W2`, `W5`–`W8` (the test gate) and `W1`–`W4` (the image-publishing workflow) | `test/ci-test-job.test.js`, `test/brains-launcher-repo.test.js` | source contract |
| AC-6 | `V2`: the workflow diff holds three kinds of change only (procedural, below) | — | at review |
| AC-6 | `V3`: the changed workflows run green (procedural, below) | — | on the PR, then on staging |

AC to handles: AC-1 → R1, S1, S2, S3, S4, W3, W4, W9, V1. AC-2 → R2, R3, S5, S6, S7, S8. AC-3 → R4, S9, S10, S11, S12,
S13, S13b. AC-4 → R0, M1, S14, S15, S16. AC-5 → D1, D2, D3, D4. AC-6 → the existing W-handles, V2, V3.

### What this phase changed in existing tests

Only what AC-6 authorizes: `W3`, `W4` and `W9` in `test/ci-test-job.test.js` named `actions/checkout@v5` and
`actions/setup-node@v5`. They now ask for the same two actions by commit id, with a `# v5.x.y` comment (W3, W4) and
nothing after the commit id (W9). Their names and every other assertion are unchanged. The new suite is registered in
`test/registry.js`.

Round 2, after the first review: the guard also catches the object filter `secrets.*` and a secret named with spaces
round the dot (`S13`, `S11`). After the second: it looks for "every secret" only inside expressions (`${{ … }}` and
`if:`), so a shell glob such as `config/secrets.*` is not a finding (`S10`), and it reads each string as written, so a
line break round the dot is still seen (`S13`).

After the third review, which passed: that round found the change above had let two things through that the code
before it caught, and they are closed in one commit that no round reviewed. A mapping's keys are read as well as its
values, and an expression's end is looked for outside quoted text, as GitHub looks for it (`S11`, `S13`, `S13b`).
Both changes only widen what the guard reads, so it catches everything the reviewed code caught. The header comment of `test/honest-publish-reporting-ci-guard.test.js` cited a line
number of `test.yml` that this story's change had moved; it now names the step.

### Guard suite

`test/workflow-hardening.test.js` is written in this phase and is the judge of Phase 4. Phase 4 changes the workflow
files and OPERATIONS.md and does not touch `test/`.

## Edge cases

Not derivable from the acceptance criteria, and covered:

- [x] A file the guard cannot parse, or one with no jobs, is a finding, not a silent pass (`S14`).
- [x] The words `uses:` inside a script are not a call (`S4`). The checks read the parsed workflow, so script text is
      never mistaken for a key.
- [x] A reusable workflow called by a job, and a `docker://` image, are held to the PIN rule (`S4`, `S1`, `S2`).
- [x] A pin whose comment names the moving tag (`# v5`) is caught: the comment must name a release (`S3`).
- [x] A job that reads secrets without naming them, by `toJSON(secrets)`, the object filter `secrets.*`, `secrets[…]`
      or `secrets: inherit`, is caught, because no one environment covers every server (`S13`).
- [x] A deploy secret read outside any job, a `DEPLOY_` secret of an unknown kind, and a deploy secret named in lower
      case or with spaces round the dot (`S13`, `S11`).
- [x] A job that widens its own token, `contents: write` even when a list names it, and a stale entry in the list of
      write scopes (`S7`, `R3`).
- [x] An environment given as `name:` and `url:`, and one whose name is computed (`S9`, `S11`).
- [x] The rules bind today's files: each real workflow is broken in memory, one rule at a time, and the break is
      caught (`M1`). Without it, a checker that found nothing would pass every file.

Not covered, with the reason:

- Whether an environment exists in GitHub, which branches it accepts and which secrets it holds. Those are settings,
  not files, and are the owner's work (story, Out of scope).
- Whether a pinned commit is the one its tag pointed to. That needs the network, so it is `V1`, at review.
- What a pinned action itself calls. An action pinned by commit can call another by tag inside its own repository;
  this repo's files cannot see that.
- Matrix-built job names and `workflow_call` inputs. No workflow here uses them.
- A local action's own `action.yml`, and a job's `container:` or `services:` image named by a tag. The PIN rule reads
  the `uses:` lines of workflow files. No workflow here has either, and no `action.yml` is tracked (review round 1,
  non-blocking 2).
- Every other expression that could yield a secret without naming it. The guard knows the four above. It is a
  tripwire; the control is each environment's branch limit in GitHub.

## Test infrastructure
- Test framework: Node built-in runner (`node test/test.js`), through `test/registry.js`. A run's result is read per
  [Running and reading the test gate](../../../README.md#running-and-reading-the-test-gate).
- Parser: `js-yaml`, already a dependency (`bin/control-panel.js`, `test/operations.test.js`). No new dependency.
- Concept Graph API: not used. The suite needs no stack.
- Firmware state: none.
- Fixtures: made-up workflows built in the suite; `S16` writes two files to a temporary folder and removes it.

## How to run

```
npm test
```

The suite alone:

```
node -e "require('./test/workflow-hardening.test.js').run().then((r) => console.log(r))"
```

**Where the full gate's result comes from.** From the pull request's `Test` run, on a clean runner. Don't take it
from a machine whose `tapestry` container is anything but a scratch stack: about forty suites run live tests through
`docker exec` on that container and on port 7778, some of them writing, and `BRAINSTORM_BASE_URL` does not turn those
off. This story's suites need no stack and can be run one at a time, as above.

**How that run is read.** One suite on `staging` is red for a reason outside this story: `setup-alert-polish` S2
(OPEN.md row `2026-11-07-reading-writeverbs-raw-publish`). While that row is open, every pull request into `staging`
fails on that one test.

- If the fix for S2 is on `staging` when this pull request's run starts, the run must be green. A re-run of an older
  run does not count: it tests the same merge of branch and base as the first time, so it takes a new push to pick
  the fix up.
- If it is not, the run counts for this story when every step before `npm test` succeeds on the pinned actions and
  S2 is the run's only failure. Shipping on that reading needs the owner's OK, recorded in the review.

## Verification

### Procedural handles

- **`V1` (AC-1), at review.** For each pinned action, `git ls-remote` shows the pinned commit under both the former
  tag and the release named in the comment:

  ```
  git ls-remote --tags https://github.com/<owner>/<repo> <tag> '<tag>^{}' '<tag>.*'
  ```

  Read on 2026-11-13, each tag pointed at a commit that is also a release:

  | Action | Tag | Commit | Release |
  |---|---|---|---|
  | `actions/checkout` | `v5` | `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09` | v5.1.0 |
  | `actions/setup-node` | `v5` | `a0853c24544627f65ddf259abe73b1d18a591444` | v5.0.0 |
  | `appleboy/ssh-action` | `v1` | `0ff4204d59e8e51228ff73bce53f80d53301dee2` | v1.2.5 |
  | `docker/build-push-action` | `v6` | `10e90e3645eae34f1e60eeb005ba3a3d33f178e8` | v6.19.2 |
  | `docker/login-action` | `v3` | `c94ce9fb468520275223c153574b00df6fe4bcc9` | v3.7.0 |
  | `docker/setup-buildx-action` | `v3` | `8d2750c68a42422c14e847fe6c8ac0403b4cbd6f` | v3.12.0 |

  The Implementer reads them again on the day of the change, and the Reviewer reads them a third time.

- **`V2` (AC-6), at review.** The workflow diff holds three kinds of change and nothing else: a `uses:` line's
  reference and comment, an added top-level `permissions:` block, and an added `environment:` line. This prints
  nothing when that holds (added comment lines are let through, since a comment changes no behavior):

  ```
  git diff origin/staging -- .github/workflows | grep -E '^[+-][^+-]' | grep -v -E '^[+-][[:space:]]*(-[[:space:]]+)?uses: |^\+permissions:|^\+  [a-z-]+: (read|none)$|^\+[[:space:]]+environment: |^\+[[:space:]]*#'
  ```

  The command is a quick screen with two blind spots: it skips a changed line whose own text starts with `-` or `+`,
  and it lets any changed `uses:` line through, whatever it now names. So also pair the removed and added `uses:`
  lines by action name, where each name must show the same count on both sides:

  ```
  git diff origin/staging -- .github/workflows | grep -E '^[+-][[:space:]]*(-[[:space:]]+)?uses: ' | sed -E 's/^([+-])[[:space:]]*(-[[:space:]]+)?uses: ([^@[:space:]]+).*/\1 \3/' | sort | uniq -c
  ```

  And compare each workflow, parsed, before and after, as review round 1 did.

- **`V3` (AC-6), on the pull request and after the merge.** The pull request's own `Test` run is the first run of
  the test gate with pinned actions. It is read as "How that run is read" says, above. After the merge, the first
  `Deploy to Staging` run must succeed. The merge also changes the image-publishing workflow, which is in its own
  `paths` list, so it rolls the brains: that run must succeed too. `main`, `feat/tags` and `feature-magic-carpet`
  run their own copies, which change when the change reaches them.

### `V3`, as it ran

- **First run, before the fix for S2 was on `staging`** (run `43529310291`, head `7f5245a0`, 2026-11-13). Checkout
  and Node setup ran from their pinned commits, `npm ci` succeeded, and `npm test` ended 7,089 passed, 1 failed, 593
  skipped across 339 suites. The one failure was `setup-alert-polish`, the known red. That is the second reading
  under "How that run is read".
- **The fix then landed** (TapestryProtocol/tapestry#51, 2026-11-14), on the owner's choice to merge it first, and
  `staging` was merged into the branch again so that a new run tests against it. That run's result is on the pull
  request; a result that is not green is a finding.

### The new tests fail with the current code

Confirmed on 2026-11-13 at commit `1dc1ca44`, with this phase's test changes in the working tree and no workflow or
doc change. The guard's own tests (`S1`–`S16`, `R0`, `R3`, `M1`) pass, as they must: they test the checkers, which
this phase delivers. The rule and doc tests fail, each for its reason:

```
$ node -e "require('./test/workflow-hardening.test.js').run().then((r) => console.log(r))"
  ✗ R1 (AC-1): every action in every workflow is pinned to its full commit id, with its released version in a comment
      11 found: deploy-magic-carpet.yml: PIN: job deploy calls appleboy/ssh-action@v1 by a tag or branch; pin it to its full 40-character commit id | …
  ✗ R2 (AC-2): every workflow declares what its token may do, none can write repository contents, and every write scope is listed
      5 found: deploy-magic-carpet.yml: TOKEN: declares no permissions for its token; add a top-level permissions: block (contents: read, or {} for none) | …
  ✗ R4 (AC-3): every job that reads a deploy secret names that server's environment
      5 found: deploy-magic-carpet.yml: ENV: job deploy reads MAGIC_CARPET's deploy secrets but names no environment; add "environment: magic-carpet" | …
  ✗ D1 (AC-5): OPERATIONS.md says a deploy target's secrets belong in its environment, limited to its deploy branch
      OPERATIONS.md needs a section whose heading names the deploy environments (story AC-5).
  ✗ D2 (AC-5): OPERATIONS.md gives the order for moving an existing target's secrets
      OPERATIONS.md needs a section whose heading names the deploy environments (story AC-5).
  ✗ D3 (AC-5): the new-target setup in OPERATIONS.md creates the target's environment and puts its three secrets there
      the new-target setup must have the reader create the target's environment before it names the secrets that go in it (story AC-5).
  ✗ D4 (AC-5): OPERATIONS.md says how to move a pin to a newer release
      OPERATIONS.md needs a section whose heading names the pinned actions (story AC-5).
{ pass: 19, fail: 7 }

$ node -e "require('./test/ci-test-job.test.js').run().then((r) => console.log(r))"
  ✗ W3 (AC-1): checks out with full history (fetch-depth: 0) so lint L9/L10 stay live in CI
      must use actions/checkout pinned to its full commit id, with a "# v5.x.y" comment (…)
  ✗ W4 (AC-1): sets up Node 22 (production Dockerfile parity) with npm cache
      must use actions/setup-node pinned to its full commit id, with a "# v5.x.y" comment (…)
  ✗ W9 (supply chain): only the two official actions/* are used — no unpinned third-party actions
      only official actions/checkout + actions/setup-node are authorized in this gate, each pinned to its full commit id; found unexpected action "actions/checkout@v5" (…)
{ pass: 11, fail: 3 }
```

`R1` counts 11, not 12: the image-publishing workflow calls `docker/build-push-action@v6` twice in one job, and the
two findings read the same.

`test/brains-launcher-repo.test.js` passes 31 of 31 before and must after.
