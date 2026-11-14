# PRD Seed: What a GitHub workflow in this repo may run and reach

**Mode:** reconstructed from as-built *(no prior PRD)*
**Build audit:** `engineering-team/audits/workflow-hardening/audit.md`
**Anchor:** acceptance frame in `book.md`
**Confidence:** medium. The scope is the frame's and is high-confidence. The vision, the personas and the rules below are read off what was built.
**Date:** 2026-11-14

> This is a **reverse-engineered baseline** in the product-team PRD shape, built from what shipped. It is a *strawman for the product team*, not a ratified spec. Every section is tagged: `[FROM FRAME]` (grounded in the kickoff acceptance frame), `[INFERRED]` (read off the as-built system), or `[UNKNOWN — product input needed]`.

## 1. Product vision

`[INFERRED]` In this repo a push to a branch puts code on a server. The workflows that do it are part of what an operator runs, so what they may run and reach should be fixed by files in the repo, not by a tag someone else controls or a setting that a repo move can lose. This book fixed three such things in the files and added a test that keeps them fixed.

`[UNKNOWN — product input needed]` How far the owner wants this to go. The book stops at making a tighter setup possible. It does not decide who may deploy, or whether a person approves a production deploy.

## 2. Personas

- `[FROM FRAME]` **The owner**, who administers the repo's settings and the servers. They move secrets, limit environments and merge promotions.
- `[FROM FRAME]` **Someone adding or changing a workflow**, a person or an agent. The test suite tells them when a workflow breaks a rule, and names the file and the rule.
- `[INFERRED]` **The keeper of a long-lived deploy branch.** They inherit the rules when the change reaches their branch, including for workflows that only their branch holds. A guess: the book met this persona only through one branch's two extra workflows.

## 3. Scope (as-built)

`[FROM FRAME]` All six bullets of the frame shipped, on `staging`:

- Every action a workflow calls is pinned to a full commit, with its release in a comment.
- Every workflow declares what its token may do, and none can write to the repository's contents.
- Every job that reads a deploy secret names a GitHub environment: `tapestry`, `staging`, `tags`, `magic-carpet` or `ninja`.
- A test in `npm test` fails when a workflow breaks any of the three.
- OPERATIONS.md says how to set up a deploy target's environment and how to move a pin.
- Deploys and the test gate behave as before.

`[INFERRED]` Beyond the frame: the test also fails a workflow that reads every secret without naming one, and the `ninja` box's runbook now sets its secrets up in its environment.

`[FROM FRAME]` Out of scope, and still so: the settings in GitHub that limit an environment to a branch, and moving the secrets into it.

## 4. Domain model

`[INFERRED]` No concept in the concept graph is involved. The things this work is about:

- **Workflow.** A file under `.github/workflows/`. Each long-lived deploy branch carries its own copy, and a push runs the copy on the branch pushed.
- **Action call.** A workflow's use of someone else's code. As built, it is named by a commit id, with the release that commit is in a comment.
- **Token permissions.** What the workflow's own GitHub token may do. Declared once per workflow. A write scope has to be listed in the test.
- **Deploy target.** A server a workflow deploys to. It has a deploy branch, three deploy secrets that share a suffix, and an environment named for that suffix.
- **Environment.** GitHub's container for a target's secrets, which can be limited to branches and can require an approval. GitHub creates one, empty, the first time a job names it.
- **The guard.** The test suite that reads every workflow file and holds the rules.

## 5. Design rules (as-built)

`[INFERRED]` from the shipped files, OPERATIONS.md §18 and the review:

- An action is called by commit id, never by a tag or branch. Its comment names a release, not a moving tag.
- A pin is moved by hand, and whoever reviews the move reads the pin again.
- A workflow asks for the least its jobs need. A deploy workflow's token gets nothing.
- An environment's name is the deploy secrets' suffix, in lower case, with hyphens.
- A job reads one server's deploy secrets, by name.
- A comment in a workflow names a doc section by its title, not its number.

No rule was ever recorded for: who approves a production deploy; how often pins are refreshed; what a long-lived branch must do before it takes a rule that `staging` adopted.

## 6. Carry-forward & open questions

From build audit §6:

- Limit the `staging` and `ninja` environments to their branches, move their secrets in, and delete the repository-level copies.
- Promote to `main`, then do the same for `tapestry`.
- Bring `feat/tags` and `feature-magic-carpet` up to the change, then do the same for `tags` and `magic-carpet`.
- On `feature-magic-carpet`, bring one extra workflow in line and decide whether the other stays.
- The SSH step's run-time download, the host key, what the guard does not read, and how pins are kept current.
- Move two Docker action pins to releases that target Node 24.
- Who has write access to the repo and their tokens; the old mirror's Actions and secrets; the public pointers that still name it.

## 7. What product must validate

- [ ] `[UNKNOWN]` Should a production deploy wait for a person's approval? The `tapestry` environment can require one. The cycle skills would then wait for it.
- [ ] `[UNKNOWN]` Should `staging` stop taking direct pushes? An environment limited to `staging` is only as closed as `staging` is, and OPERATIONS.md §4 leaves that to the operator.
- [ ] `[UNKNOWN]` Are pins moved by hand, or by an updater that opens pull requests?
- [ ] `[UNKNOWN]` Does the third-party SSH action stay, or does a plain `ssh` step replace it?
- [ ] `[INFERRED]` That the two sandboxes are meant to get the same treatment as production, on their own schedule.
- [ ] `[INFERRED]` That the keeper of a long-lived branch is a persona this work should design for, and not only a consequence of it.
