# Story 1: The GitHub workflows pin what they run, limit their token, and name a deploy environment

**Status:** Done
**Created:** 2026-11-13
**Type:** Bug (security / what a workflow can reach)
**Epic:** `workflow-hardening`
**Book:** `audits/workflow-hardening/`
**Source:** a check of this repo on 2026-11-13 against the stolen-token campaign reported publicly as "wfx". The check
found no trace of the campaign here. What it found about the workflows is described below, not named, until the
owner's settings work is done (precedent: `security-auth-exposure` #12).

## Background

In November 2026 a campaign used stolen GitHub tokens to push workflow changes into tens of thousands of
repositories, read whatever those workflows could reach, then revert the commit and delete the run. This repo was not
touched. The check did show that three things decide how far a stolen token or a tampered action reaches in a repo
like this one, and that none of the three is fixed by this repo's files:

- **What a workflow runs.** Wherever a workflow calls an action, it names it by a version tag. Whoever controls an
  action's repository can move a tag to different code. One of those actions opens the SSH session to a server.
- **What a workflow's token may do.** Five of the seven workflows don't say. A repository setting then decides, and
  settings live outside the repo's files: this repo's branch rulesets were lost that way in the move of 2026-10-23.
- **Where a deploy job's secrets come from.** No deploy job names a GitHub environment. An environment is how GitHub
  lets an owner limit a secret to the branch that deploys with it, and ask for an approval before a job receives it.

Nothing stops a workflow added later from getting any of the three wrong, because no test reads the workflows for
them.

Who is affected: the owner, who administers the repo's settings and the servers; anyone who adds or changes a
workflow; and everyone who relies on the deployments.

## User-facing description

As the owner of this repo's deployments, I want every workflow to pin the actions it runs, state what its token may
do, and name a deploy environment wherever it reads a deploy secret, so that I can limit each server's credentials to
the branch that deploys to it, and a moved tag or a lost setting can't widen what a workflow reaches.

As someone adding or changing a workflow, I want the test suite to tell me when a workflow breaks one of these rules,
so that I find out before a review or a deploy does.

## Acceptance criteria

- [ ] **AC-1 Every action is pinned to a commit.** In every workflow file, each action is referenced by its full
      40-character commit id, followed by a comment naming the released version that commit is. No workflow names an
      action by a tag or a branch. Each pin is the commit its former tag pointed to when the change was made, so the
      change freezes what runs today and upgrades nothing.
- [ ] **AC-2 Every workflow says what its token may do.** Each workflow file declares its token's permissions once,
      for the whole file. No workflow lets its token write to the repository's contents. Write access of any kind
      appears only where a job needs it for its work, which today is publishing the brain images to the package
      registry.
- [ ] **AC-3 Every deploy job names its environment.** Each job that reads a deploy secret (a secret named
      `DEPLOY_…`) names a GitHub environment, and it is the one for the server the job deploys to: `tapestry`,
      `staging`, `tags`, `magic-carpet` or `ninja`. The name is the suffix of the deploy secrets the job reads, in
      lower case with hyphens. A job reads the deploy secrets of one server only.
- [ ] **AC-4 The test suite holds the three rules.** When any workflow file breaks AC-1, AC-2 or AC-3, `npm test`
      fails and names the file and the rule. This holds for a workflow file added later, without anyone editing the
      test.
- [ ] **AC-5 The operator docs cover it.** OPERATIONS.md says that a deploy target's secrets belong in that target's
      environment, limited to its deploy branch, and how to set one up for a new target. It gives the order for
      moving an existing target's secrets: only after that target's own deploy branch carries the environment line.
      It says how to move a pin to a newer release.
- [ ] **AC-6 Nothing else changes.** Every workflow keeps its triggers, its concurrency rules, its steps and its
      scripts as they are. The existing tests about these workflows keep every assertion they have. The three that
      name an action by its tag (`test/ci-test-job.test.js` W3, W4 and W9) are amended to name it by its pinned
      commit and released version, and nothing else in them changes.

## Concepts touched

None. This is CI configuration; no concept in the concept graph is affected.

## Out of scope

- Creating and configuring the environments in GitHub (deployment branch limits, required reviewers), moving the
  secrets into them, and removing the repository-level copies. That is the owner's work in GitHub settings, done for
  each target after its own deploy branch carries this change.
- New keys for the servers.
- Who has write access to the repo, and their tokens.
- The old mirror's Actions and secrets, and the public pointers that still name it (items 2 and 3 of
  [the repo-move ledger row](../../../../ledger/2026-10-28-repo-move-follow-ups.md)).
- Automatic pin updates, such as Dependabot. That is a separate decision.
- Requiring the test gate on `staging`.
- Splitting the image-publishing job so that only its last step holds a server's credentials.

## Open questions

None open. Settled at intake on 2026-11-13:

- **Environment names** follow the deploy secrets' suffixes: `tapestry`, `staging`, `tags`, `magic-carpet`, `ninja`.
- **No ADR.** Architecture was skipped as obvious for a Bug. The convention is recorded in OPERATIONS.md.

## Deviations

- **The deploy workflows give their token nothing** (`permissions: {}`), where AC-2 would also have allowed
  `contents: read`. Their jobs check nothing out; the action they call needs no token.
- **Each added line carries a one-line comment** pointing at OPERATIONS.md's "Workflow rules" section, by name. The
  test plan's diff check lets comment lines through. The comments first named the section by number; `staging` then
  gained a section with that number, and a number would have sent the next renumbering back into six workflow files.
- **OPERATIONS.md §6.2 pointed at "§6.3 step 2" for the deploy key.** The key is made in step 3, so the sentence, which
  this story rewrites, now says step 3.
- **The full gate was not run on the development machine.** There it writes to a stack that answers as `tapestry`
  (OPEN.md row `2026-11-13-live-suites-have-no-off-switch`). The story's suites were run one at a time, and the full
  gate's result is the pull request's `Test` run, as the test plan says.

- **`deploy/RUNBOOK.md` changed too** (review round 1, B1). Its step 7 set up the `ninja` box's secrets at repository
  level, which the new section says not to do. AC-5 names OPERATIONS.md only; the runbook is where that box's setup
  lives.
- **`staging` was merged into the branch** (review round 2). It had gained a section 17 in OPERATIONS.md, so this
  story's section is 18.

- **One test-only commit follows the passing review.** Round 3 named two forms the guard had stopped catching after
  round 2's change: a secret read in a mapping's key, and one read after a quoted `}}`. The commit closes both and
  only widens what the guard reads. No round reviewed it.

## Linked artifacts
- ADR: none (Architecture skipped at intake, 2026-11-13)
- Test plan: `engineering-team/stories/workflow-hardening/1-harden-the-github-workflows.test-plan.md`
- Review: `engineering-team/reviews/workflow-hardening/1-harden-the-github-workflows.md`
