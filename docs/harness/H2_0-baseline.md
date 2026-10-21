# H^2_0 — Tapestry pinned baseline harness (P2), v0 — APPROVED

**APPROVED** (David, 2026-10-21 12:05 AM ET (relayed in chat by Chief of Staff (P0), not signed)). Q: "Approve Tapestry's baseline with these recommendations?" A: "Approve".
Held at **L1** (L0 items stay L0). Branch `harness/h2_0-baseline`.

**Pending steps** (in order):
1. Done 2026-10-21: Nous invited the Grawk Tapestry Lead key and it accepted (now a co-maintainer). Ark retirement: pending David (Ark kept on for now).
2. The Tapestry Lead merges this branch to `main` with `--no-ff`.
3. H^2_0 is pinned at that merge commit (§1).
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
| H^2_0 pin (merge commit) | `d5fe12c95ebd47c7a218e422f456e36e557f680b` on `main` (annotated tag `H2_0`) |
| Base commit | `b764663d56034cc8b5cfb8ce1b2b72b79ff55349` (`main`, 2026-10-13 23:35 PDT; "Merge pull request #865 … promote/failing-tests-feature-branch") |
| Source | ngit: `nostr://npub1zhma4lzxyjc7dvq2klux8hs62wm3je6jspcwclgcxlr6grquwfcq28ccgm/relay.ngit.dev/Tapestry`, cloned 2026-10-20 ~11:45 PM ET |
| `staging` at pin | `a191de3f6` (an ancestor of `main`; 0 commits ahead) |
| Harness-defining paths | `scripts/harness-def-paths.txt` at this branch's commit (the single definition; not restated here) |
| Owner of repo | Nous (lead maintainer); Ark co-maintainer at pin time (announcement, 2026-10-20). Tapestry Lead key added as co-maintainer 2026-10-21; Ark retirement pending David (Ark kept on for now) |
| Project authority | David (straycat, `npub1u5njm6g5h5cpw4wy8xugu62e5s7f6fnysv0sj0z3a8rengt2zqhsxrldq3`), confirmed for P2 (David, 2026-10-21 12:05 AM ET (relayed in chat by Chief of Staff (P0), not signed)) |

## 2. Harness-defining paths
`scripts/harness-def-paths.txt` is unchanged in meaning; this baseline adds:
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
| Stack-free CI | `.github/workflows/test.yml` (`npm ci && npm test`) required on PRs | **retired**; replaced by the Lead's manual pre-merge `npm test` (Q3) |
| main-source guard | `.github/workflows/guard-main-source.yml` (only `staging`/`promote/*` into `main`) | **retired** — nothing enforces it now |
| Deploys | `deploy-staging.yml`, `deploy-tapestry.yml`, `deploy-tags.yml`, `deploy-magic-carpet.yml` | **retired** — no automated deploy path |
| Ledger | `ledger/*.md` rows (Opened/Done), OPEN.md roll-up, `/whats-open`, meta escalation | live |
| Branch flow | feature → `staging` → `main` (promotion PR); `feat/tags` long-lived (`scripts/long-lived-branches.txt`) | carries over (Lead ruling, below); Tapestry Lead alone merges to `main` |
| L0 enforcement | GitHub rulesets + `.github/CODEOWNERS` | **no longer applies**; replaced by the merge rule below (David, 2026-10-21 12:01 AM ET (relayed in chat by Chief of Staff (P0), not signed)) |

## 4. Move from GitHub to ngit
- **Where the repo lives:** ngit (nostr), URL in §1, served from relay.ngit.dev and gitnostr.com.
  `github.com/nous-clawds4/tapestry` is unreachable: the nous-clawds4 account was suspended on
  2026-10-19. GitHub is off limits to all agents until David says otherwise.
- **Review:** ngit PRs are branches pushed as `pr/<name>` (or `ngit send`); a maintainer merges
  with `ngit merge` (local no-ff) and pushes. There are no GitHub review approvals, required
  reviewers or status checks. Review verdicts in `engineering-team/reviews/**` remain the record.
- **CI:** no workflow runs. `.github/workflows/*` are kept in the tree, retired, in case GitHub
  returns (physics precedent: David, 2026-10-20 9:23 PM ET, relayed, for physics only). `ngit ci`
  exists but nothing is configured; the gate is the Lead's manual pre-merge `npm test` (Q3).
- **CODEOWNERS and branch protection:** `.github/CODEOWNERS` and rulesets were enforced by GitHub
  only. On ngit, anyone with a maintainer key can push any branch, including `main`.
  **GitHub-based L0 enforcement (rulesets, CODEOWNERS) no longer applies.** Until question 2
  was answered, L0/L1 holds had no enforcement. Now decided: see "Merging and L0/L1 holds".
- **Writes** follow the infinite harness' `docs/guardrails.md` (rate caps, backoff, halt on
  suspension, log every write).

## 5. P2 scorecard (accepted baseline 2026-09-27; re-measured here)
Six separate scores; **no composite**. Source: infinite-harness `docs/examples/tapestry.md`
§ "The P2 scorecard". Re-measured 2026-10-20 from the local ngit clone at the pin, where possible.

| # | Score | Better | 2026-09-27 baseline | Re-measured at pin | Status |
|---|---|---|---|---|---|
| 1 | Escaped failures: red stack-free runs on `staging → main` promotions, per promotion | lower | 3 / 61 | not measurable (CI run history was on GitHub) | **unverified**; GitHub-era baseline; now measured locally (Q6) |
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

## Merging and L0/L1 holds (David's ruling)
(David, 2026-10-21 12:01 AM ET (relayed in chat by Chief of Staff (P0), not signed)): "Same as Physics: Lead's key merges, Nous backup, L0/L1 need my OK". A ruling; no hold level stated.
- Grawk Tapestry Lead alone merges to `main`, signing with its own key:
  `npub1z5ff8zypsx2tz60py59jnh2r8fsyqagdt65xck2ylk2yrmfzdmdqsv2qyy`.
- Nous (repo owner, `npub1zhma4lzxyjc7dvq2klux8hs62wm3je6jspcwclgcxlr6grquwfcq28ccgm`) is the
  backup merger. No extra break-glass key (as physics).
- Any change to an L0 or L1 item needs David's OK in chat **before** it is merged, recorded verbatim
  with time (ET), channel and "signed" / "relayed, not signed".
- Everyone else pushes only `pr/<agent>-…` branches (ngit proposals), signed with their own key
  (`git -c nostr.signer=<npub> push`). Never print keys. Keys are attribution only: agents share one box.
- This replaces CODEOWNERS and rulesets as the L0/L1 control. It is enforced by the Lead's merge
  discipline, not by the host; the diff-audit (§5) checks it after the fact.

## How the questions were classified
- **Follows from David's ruling**: a direct consequence of the 12:01 AM ruling; no new decision.
- **Lead ruling**: operational, below L1, reversible, and does not change who decides or what an
  L0/L1 item says. Marked "Lead ruling (Tapestry Lead, 2026-10-21)". David may overrule any of them.
- **Open for David**: touches authority, signing, keys/maintainers, hold levels, the gate that
  stands in for an L1 control, or what ships to production. Each carries a one-line recommendation.

## Open questions for David
None open.

## Approved by David
All: (David, 2026-10-21 12:05 AM ET (relayed in chat by Chief of Staff (P0), not signed)). Q: "Approve Tapestry's baseline with these recommendations?" A: "Approve".
The recommendations below became David rulings exactly as written.
1. **P2 authority and signing.** straycat (`npub1u5njm6g5h5cpw4wy8xugu62e5s7f6fnysv0sj0z3a8rengt2zqhsxrldq3`)
   is the P2 authority. Relayed OKs count for now; any L0 change needs a signed note.
3. **CI gate replacement.** Before every merge to `staging` or `main`, the Lead runs `npm test` by hand
   on the merge result (link-check suites skipped, Q13) and records the result line in the merge commit.
4. **Keys and maintainers.** Each agent gets its own nostr key (physics model; attribution only).
   The Tapestry Lead key becomes a maintainer (done 2026-10-21); Ark retirement is pending David
   (Ark kept on for now).
8. **GitHub-only work.** Router hardening #787 is re-raised as an ngit proposal; GitHub PR history
   is treated as lost.
11. **Hold level.** H^2_0 is held at L1; L0 items stay L0.
12. **Production deploys.** Manual, each with David's OK.

## Follow-up items
- Re-raise router hardening (GitHub #787) as an ngit proposal against `staging` (Q8). Not done yet.
- Nous: Tapestry Lead key added as maintainer (done 2026-10-21). Ark retirement pending David (Q4).

## Answered / settled
2. **L0/L1 enforcement on ngit.** Follows from David's ruling (David, 2026-10-21 12:01 AM ET (relayed in chat by Chief of Staff (P0), not signed)): Lead's key merges,
   Nous backup, L0/L1 need David's OK. See "Merging and L0/L1 holds".
5. **Branch flow.** Follows from David's ruling (only the Lead merges to `main`), plus a Lead ruling
   (Tapestry Lead, 2026-10-21) that the rest carries over: feature → `staging` → `main` by promotion;
   `feat/tags` stays long-lived with its owners; "only `staging`/`promote/*` into `main`" stays a rule,
   enforced by the Lead at merge time instead of the retired workflow.
6. **GitHub-dependent metrics.** Lead ruling (Tapestry Lead, 2026-10-21): keep all six scores,
   measured locally. Score 1 = test failures on the Lead's pre-merge `npm test` of a promotion,
   per promotion; score 3 = failed pre-merge runs ÷ runs, from the merge-commit summary lines;
   score 4 = reverts plus merges of `hotfix/*` branches, from `git log --first-parent main`.
   GitHub-era baselines stay as recorded and are not compared across the change. Scores 1 and 3
   have no data until question 3 is answered.
7. **Deploy mechanics.** Lead ruling (Tapestry Lead, 2026-10-21): with the deploy workflows retired,
   staging deploys are run by hand by the Lead from a merged `staging` commit, and the commit is
   recorded. Production: Q12 (manual, David's OK each time).
9. **Security hotfixes in score 4.** Lead ruling (Tapestry Lead, 2026-10-21): count them in score 4
   and also report the security share separately; nothing is excluded from the score.
10. **Retired workflows.** Lead ruling (Tapestry Lead, 2026-10-21), following the physics ruling
    (David, 2026-10-20 9:23 PM ET, relayed, not signed, for physics): keep `.github/workflows` in the
    tree, retired, in case of a return to GitHub. Listed in `harness-def-paths.txt`.
13. **GitHub link-check suites.** Lead ruling (Tapestry Lead, 2026-10-21): local test runs skip the
    `llms-txt` and `information-for-agents` link checks, which fetch github.com URLs. GitHub is off
    limits; their failures are expected and are not test failures. Repointing those links to ngit is
    a later change.
