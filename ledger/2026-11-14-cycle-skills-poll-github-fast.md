# The cycle skills look for a deploy run every 10 seconds and watch it at `gh`'s default pace

**Id:** 2026-11-14-cycle-skills-poll-github-fast
**Type:** meta
**Opened:** 2026-11-14 (workflow-hardening book close; the two merges into `staging` of that day)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The recipe.** `.claude/skills/cycle-staging/SKILL.md` step 6 and `.claude/skills/cycle-prod/SKILL.md` look for the
  deploy run with `gh run list` every 10 seconds, up to 30 times, then run `gh run watch` with no `--interval`. `gh`'s
  default is a request every 3 seconds.
- **What that costs.** A staging merge that also rolls the brains takes about 12 minutes. Watched at the default pace,
  that is a few hundred requests for one merge.
- **The team's rule for GitHub requests is slower:** one request at a time, and `gh run watch --interval 30`.
- **What this book did.** Both merges looked every 20 seconds and watched at 30. Each found its run on the first
  lookup, and the whole of one merge took about thirty requests.

**Fix shape.** `--interval 30` on every `gh run watch` in the cycle skills and in `/direct-feature`, and a lookup every
20 to 30 seconds. The lookup by commit stays: it is what keeps a smoke test off the previous container.

**Pointer:** `.claude/skills/cycle-staging/SKILL.md` step 6; `.claude/skills/cycle-prod/SKILL.md`;
`engineering-team/audits/workflow-hardening/audit.md` §7.
