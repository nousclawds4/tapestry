# Epic: workflow-hardening

**Created:** 2026-11-13
**Status:** Done (epic retired 2026-11-14 at the workflow-hardening book close: story 1 Done, on `staging` via TapestryProtocol/tapestry#54; `main` and the sandbox branches take it at their next promotion or sync)
**Book:** `engineering-team/audits/workflow-hardening/book.md` (acceptance frame; human-gated; Standard, Bug lane,
Architecture skipped at intake)
**Provenance:** Owner request 2026-11-13 (in-session), out of a check of this repo against the stolen-token campaign
reported publicly as "wfx" in November 2026. The check found no trace of the campaign here. It also found that
nothing in the repo's files fixes what a workflow runs, what its token may do, or where a deploy job's secrets come
from.

## Goal

Every GitHub workflow in this repo pins the actions it runs, states what its token may do, and names a deploy
environment wherever it reads a deploy secret. The test suite keeps it that way.

## Why it matters

A workflow is code that runs with the repo's credentials. A moved tag, a repository setting lost in a move, or a
workflow added without these in mind should not be able to widen what a workflow can reach. The environment line is
what lets the owner limit each server's credentials to the branch that deploys to it.

## Stories

`stories/workflow-hardening/`:

1. `1-harden-the-github-workflows.md` — pinned actions, declared permissions, deploy environments, the guard test and
   the operator docs. Bug.

## Decisions

None planned. Architecture was skipped at intake as obvious for a Bug: three mechanical rules, with the convention
recorded in OPERATIONS.md.

## Key facts / guardrails

- **The change freezes what runs today.** A pin is the commit its tag pointed to on the day of the change. Nothing is
  upgraded.
- **Each long-lived deploy branch runs its own copy of its workflow.** The change lands on `staging` and reaches
  `main`, `feat/tags` and `feature-magic-carpet` by the usual promotion and sync. A target's secrets move into its
  environment only after its own branch carries the change. `feature-magic-carpet` also holds two workflows that
  `staging` doesn't, and both name deploy secrets (book, "What stays open").
- **Settings stay the owner's.** Creating and limiting environments, moving secrets and making new keys happen in
  GitHub settings and on the servers, outside this epic.
- **`.github/workflows` is a harness-definition path.** The commit that changes it also adds a row to
  `engineering-team/CHANGELOG.md` (lint L10).
- **Three existing tests name an action by its tag** (`test/ci-test-job.test.js` W3, W4 and W9). Story 1 authorizes
  amending those three, and no others.
- **The hole is described, not named, until the owner's part is done** (precedent: `security-auth-exposure` #12).
