# Book of Work: The GitHub workflows pin what they run, limit their token, and name a deploy environment

**Slug:** workflow-hardening
**Status:** Closed
**Opened:** 2026-11-13
**Closed:** 2026-11-14
**Gating:** **Human-gated.** Standard strictness, Bug lane. Architecture was skipped at intake as obvious, on the
owner's choice (2026-11-13). No Direction mode.

## Intent anchor

**Acceptance frame (no PRD)**: the owner's ask of 2026-11-13, "prepare the workflow hardening pull request". It
followed a check of this repo against the stolen-token campaign reported publicly as "wfx", which found no trace of
the campaign here. The ask was restated as the six bullets below and confirmed by the owner the same day. Completion
is *judged* against them.

### Acceptance frame

- [x] Every action a workflow calls is pinned to a full commit. *(Story 1, AC-1. Twelve calls to six actions; each
      pin read three times against its tag.)*
- [x] Every workflow declares what its token may do, and none can write to the repository's contents. *(Story 1,
      AC-2.)*
- [x] Every job that reads a deploy secret names a GitHub environment: `tapestry`, `staging`, `tags`, `magic-carpet`
      or `ninja`. *(Story 1, AC-3. In the files on `staging`; GitHub created `staging` and `ninja` at the merge.)*
- [x] A test in `npm test` fails when a workflow breaks any of the three rules above. *(Story 1, AC-4:
      `test/workflow-hardening.test.js`, 27 tests.)*
- [x] OPERATIONS.md says how to set up a deploy target's environment and how to move a pin. *(Story 1, AC-5: §18,
      §6.2.)*
- [x] Deploys and the test gate behave as before. The settings work in GitHub (limiting each environment to its
      branch, moving the secrets in) stays with the owner and is not part of this book. *(Story 1, AC-6. The pull
      request's `Test` run read 7,090 passed, 0 failed; the staging deploy and the brains' roll for the merge both
      succeeded; staging passed its smoke test.)*

Shipped to `staging` as TapestryProtocol/tapestry#54 (merge `55573a32`, 2026-11-14), on the owner's OK. Not promoted to
`main`.

## What stays open

In the build audit's carry-forward register (`audit.md` §6): the owner's settings work, the promotion to `main`, the
two sandbox branches, the two workflows that only `feature-magic-carpet` holds, and the follow-ups queued in
`engineering-team/stories/_intake.md` (entry of 2026-11-13).

Outside this book: items 2 and 3 of [the repo-move ledger row](../../../ledger/2026-10-28-repo-move-follow-ups.md).

## Epics in this book
- `workflow-hardening` — story 1.

## Provenance
- **Mode:** Acceptance-frame
- **Confidence at close:** high for the six bullets, each shown on `staging` by a run. The frame stops at `staging`.

## Close artifacts
- Build audit: `engineering-team/audits/workflow-hardening/audit.md`
- Product feedback: `engineering-team/audits/workflow-hardening/prd-seed.md`
