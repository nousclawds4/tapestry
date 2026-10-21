# H^2_0 — Tapestry pinned baseline harness (P2), draft v0

**DRAFT on branch `harness/h2_0-baseline`. Do not merge until David approves.**
Requested by David, 2026-10-20 11:37 PM ET (relayed in chat by Chief of Staff (P0), not signed,
no hold level stated): "let's pin its baseline". Modelled on physics' H^1_0 (physics `main`
`ce14e11`: AGENTS.md, docs/harness/*, harness-def-paths.txt, docs/harness/CHANGELOG.md) and the
infinite harness' AGENTS.md (`main` `825689a`). Written from what the Tapestry harness does now,
not an ideal. Nothing in "Open questions for David" is decided here.

This file *pins* the existing harness; it does not replace it. The harness itself stays where it
is: CLAUDE.md, AGENTS.md, BIBLE.md (domain spec), `engineering-team/`, `product-team/`,
`.claude/`, and the scripts in `scripts/`. AGENTS.md is not edited because it sits at its
L11 line budget (102).

## 1. Pin
| Item | Value |
|---|---|
| Baseline commit | `b764663d56034cc8b5cfb8ce1b2b72b79ff55349` (`main`, 2026-10-13 23:35 PDT; "Merge pull request #865 … promote/failing-tests-feature-branch") |
| Source | ngit: `nostr://npub1zhma4lzxyjc7dvq2klux8hs62wm3je6jspcwclgcxlr6grquwfcq28ccgm/relay.ngit.dev/Tapestry`, cloned 2026-10-20 ~11:45 PM ET |
| `staging` at pin | `a191de3f6` (an ancestor of `main`; 0 commits ahead) |
| Harness-defining paths | `scripts/harness-def-paths.txt` at this branch's commit (the single definition; not restated here) |
| Owner of repo | Nous (lead maintainer); Ark co-maintainer (from the ngit repo announcement, 2026-10-20) |
| Project authority | David (straycat, `npub1u5njm6g5h5cpw4wy8xugu62e5s7f6fnysv0sj0z3a8rengt2zqhsxrldq3`), as recorded in the infinite harness for all projects; P2 confirmation is open question 1 |

## 2. Harness-defining paths
`scripts/harness-def-paths.txt` is unchanged in meaning; this draft adds:
- `.github/workflows` — **retired with GitHub** (see §4). Listed so any edit is L10-visible.
- `docs/harness` — this baseline and its notes.
Records (stories, reviews, decisions, audits, ledger rows, OPEN.md, handoffs) stay out, as before.

## 3. Current gates (as of the pin)
| Gate | What | Status after the move to ngit |
|---|---|---|
| Phase flow | PO → Architect → Tester → Implementer → Reviewer, `engineering-team/workflows/0–6` (+ Light profile, protocol-spec workflow); product-team flow upstream | live (repo-local) |
| Review verdicts | Reviewer files in `engineering-team/reviews/**`, parsed by `scripts/lib/review-verdict.awk`; Reviewer flips story Done on PASS | live |
| harness-lint | `scripts/harness-lint.sh` L1–L13 at session start (`.claude/settings.json` hook → `scripts/session-start.sh`); waivers in `scripts/harness-lint-waivers.txt`; budgets in `scripts/harness-budgets.txt` (L11) | live (local only; nothing runs it server-side) |
| Touch-rule | a diff touching a harness-def path also touches `engineering-team/CHANGELOG.md` (L10) | live |
| Test suite | `npm test` (`node test/test.js`) | live locally |
| Stack-free CI | `.github/workflows/test.yml` (`npm ci && npm test`) required on PRs | **retired** — GitHub suspended; no replacement yet (open question 3) |
| main-source guard | `.github/workflows/guard-main-source.yml` (only `staging`/`promote/*` into `main`) | **retired** — nothing enforces it now |
| Deploys | `deploy-staging.yml`, `deploy-tapestry.yml`, `deploy-tags.yml`, `deploy-magic-carpet.yml` | **retired** — no automated deploy path |
| Ledger | `ledger/*.md` rows (Opened/Done), OPEN.md roll-up, `/whats-open`, meta escalation | live |
| Branch flow | feature → `staging` → `main` (promotion PR); `feat/tags` long-lived (`scripts/long-lived-branches.txt`) | convention only on ngit (open question 5) |
| L0 enforcement | GitHub rulesets + `.github/CODEOWNERS` | **no longer applies** (see §4) |

## 4. Move from GitHub to ngit
- **Where the repo lives:** ngit (nostr), URL in §1, served from relay.ngit.dev and gitnostr.com.
  `github.com/nous-clawds4/tapestry` is unreachable: the nous-clawds4 account was suspended on
  2026-10-19. GitHub is off limits to all agents until David says otherwise.
- **Review:** ngit PRs are branches pushed as `pr/<name>` (or `ngit send`); a maintainer merges
  with `ngit merge` (local no-ff) and pushes. There are no GitHub review approvals, required
  reviewers or status checks. Review verdicts in `engineering-team/reviews/**` remain the record.
- **CI:** no workflow runs. `.github/workflows/*` are kept in the tree, retired, in case GitHub
  returns (physics precedent: David, 2026-10-20 9:23 PM ET, relayed, for physics only). `ngit ci`
  exists but nothing is configured; whether to adopt it is open question 3.
- **CODEOWNERS and branch protection:** `.github/CODEOWNERS` and rulesets were enforced by GitHub
  only. On ngit, anyone with a maintainer key can push any branch, including `main`.
  **GitHub-based L0 enforcement (rulesets, CODEOWNERS) no longer applies.** Until open question 2
  is answered, L0/L1 holds are enforced by agent discipline and review only.
- **Writes** follow the infinite harness' `docs/guardrails.md` (rate caps, backoff, halt on
  suspension, log every write).

## 5. P2 scorecard (accepted baseline 2026-09-27; re-measured here)
Six separate scores; **no composite**. Source: infinite-harness `docs/examples/tapestry.md`
§ "The P2 scorecard". Re-measured 2026-10-20 from the local ngit clone at the pin, where possible.

| # | Score | Better | 2026-09-27 baseline | Re-measured at pin | Status |
|---|---|---|---|---|---|
| 1 | Escaped failures: red stack-free runs on `staging → main` promotions, per promotion | lower | 3 / 61 | not measurable (CI run history was on GitHub) | **unverified**; depends on GitHub (open question 6) |
| 2 | Honest kick-back rate: CHANGES_REQUESTED rounds ÷ decided reviews | lower | 48 / 244 with kick-back history | 77 / 301 with kick-back history (~26%); headline still "0%"; rounds not yet counted | re-measured (`harness-stats.sh`) |
| 3 | CI red rate: failed `test.yml` runs ÷ decided runs | lower | 8 / 216 | not measurable | **unverified**; depends on GitHub |
| 4 | Change-fail: reverts + `hotfix/*` merges into `main`, per promotion | lower | 0 reverts, 0 hotfix | 0 reverts; **7 `hotfix/*` merges** into `main` since 2026-09-27 (#830, #837, #839–#841, #844, #847) over 25 promotion merges | re-measured (`git log --first-parent main`) |
| 5 | Ledger flow: opened vs closed per week, `meta` share separate | closed ≥ opened | 85 rows, 73 OPEN / 12 DONE | 288 row files; 47 with `**Status:** DONE` (grep) | row counts re-measured (grep-level); weekly rates and meta share **unverified** |
| 6 | Harness-change prediction/outcome hygiene: share of CHANGELOG rows with a prediction and outcome | higher | 0% | 0% of 81 rows (no such columns); 4 rows discharge a missed touch-rule | re-measured |

- **Held-out cold review:** periodically, an external model that took no part in the work reviews
  a sample of recently merged changes cold against the **original G^2 text** (no paraphrase),
  across all three kinds of instance — an individual's personal instance, a community leader's
  instance serving members, and an enterprise search service. Score = changes that serve one kind
  at another's expense or break an architecture invariant (lower is better). H^2_0 cannot see or
  edit the examiner's prompt. No baseline yet; the first review sets it.
- **Diff-audit flags:** every change to H^2_0 is read for weakened definitions, loosened checks and
  hold demotions. Flagged, not scored. A demotion of an L0/L1 item without a ruling **signed** by
  the P2 authority is always a finding; **unsigned demotions are flagged, never scored.**
- **Counting rule:** a rung-1 change counts only when its outcome is **confirmed** on the metric its
  prediction named. Refuted, reverted or inconclusive outcomes are kept as data about the rung.
- **Rung 2 stays closed until at least 5 rung-1 changes have recorded outcomes.**

## 6. Changing H^2_0
- Every change to a path in `scripts/harness-def-paths.txt` is made on a branch, with a reason, and
  gets a row in `engineering-team/CHANGELOG.md` (L10).
- Who proposes and merges, and at what hold level, follows the infinite harness' proposal 0001
  Option B (per-project, per-file ratings; no demotions now). P2 has no rung 1 yet, so the
  Tapestry Lead proposes; a per-file rating table for P2 is still to be proposed.
- Record David verbatim, with time (ET), channel, "signed" or "relayed, not signed", and the hold
  level or "no hold level stated".

## Open questions for David
1. **P2 authority key.** Your straycat npub is recorded as authority for every project. Confirm it
   for P2, and say whether P2 rulings must be signed (nostr) to count for L0/L1.
2. **L0/L1 enforcement on ngit.** With no CODEOWNERS or rulesets, how are L0/L1 files (e.g.
   README.md, BIBLE.md, CLAUDE.md, the harness-def paths) protected? Options: maintainer-only
   push plus signed sign-off recorded in CHANGELOG; a pre-push/lint check; or ngit PR-only merges.
3. **Replacement for the stack-free CI gate.** `ngit ci`, a local `npm test` gate run by the
   merger and recorded in the PR, or something else? Who runs it and where is the result kept?
4. **Maintainers and keys.** Who may push and merge on the ngit repo? Today the announcement lists
   Nous (lead) and Ark (co-maintainer). Do the Tapestry Lead and other agents get their own keys
   (as physics did), and is Ark (and the ark-clawds4 identity) staying?
5. **Branch flow.** Does feature → `staging` → `main`, and `feat/tags` as a long-lived branch, carry
   over to ngit? Who promotes, and does the "only `staging`/`promote/*` into `main`" guard survive
   as a rule without the GitHub workflow?
6. **GitHub-dependent metrics.** Scores 1 and 3 (and the hotfix half of score 4, which counted PR
   head branches) relied on GitHub CI runs and PRs. Keep them with a new data source (question 3),
   redefine them, or drop them?
7. **Deploys.** The four deploy workflows are retired too. How do staging and production deploys
   happen now, and are they part of the harness?
8. **Lost GitHub-only work.** Open PRs that never reached ngit (e.g. router-hardening #787) and
   PR review history live only on GitHub. Re-raise them as ngit PRs, or drop them?
9. **Hotfix rise.** Score 4 went from 0 to 7 `hotfix/*` merges into `main` since 2026-09-27
   (auth/route hardening). Count security hotfixes as change-fail, or track them separately?
10. **Retired workflows.** Keep `.github/workflows` in the tree as retired (physics' choice), or
    remove them?
11. **Hold level of H^2_0.** All of it at L1 (as H^0_0), or per-file ratings from the start?
