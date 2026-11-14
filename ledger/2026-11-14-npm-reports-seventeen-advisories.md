# `npm ci` reports 17 advisories against the root lockfile, one of them rated critical

**Id:** 2026-11-14-npm-reports-seventeen-advisories
**Type:** bug
**Opened:** 2026-11-14 (workflow-hardening book close; seen in passing on 2026-11-13)
**Status:** OPEN
**Done:** —

**What was seen.** `npm ci` at the repo root on 2026-11-13, on `staging` at `6c57ec1f` with npm 11.16.0, ended with
"17 vulnerabilities (2 low, 1 moderate, 13 high, 1 critical)". It also marked two packages as deprecated:
`multer@1.4.5-lts.2`, whose 1.x line has known vulnerabilities patched in 2.x, and `cron-parser@4.9.0`, which is no
longer maintained. `package-lock.json` last changed on 2026-10-12.

**What is not known.** None of the 17 was looked at. Which of them are in code a deployment runs, and which only in
tooling, is the first thing to find out. The repo's other lockfiles (`ui/`, `nostr-search/`, `deploy/launcher/`,
`clients/cli/`, `setup/nostr/node_project/`) were not installed or checked.

**Fix shape.** Run `npm audit` for the list. Sort each advisory as reachable at run time or not. Upgrade what is
reachable, starting with the critical one, and record why for any that stays. Then the same for the other lockfiles.

**Pointer:** `package.json`, `package-lock.json`; `engineering-team/audits/workflow-hardening/audit.md` §5.
