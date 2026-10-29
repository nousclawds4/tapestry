# Two shell traps on the macOS host silently change what a recipe does: there is no `timeout`, and zsh reads `$c:src/…` as a modifier

**Id:** 2026-10-28-macos-shell-traps-in-recipes
**Type:** meta
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 3 and 9)
**Status:** OPEN
**Done:** —

**What was seen.**
- **No `timeout` binary.** The macOS host has neither `timeout` nor `gtimeout` (checked 2026-10-28, macOS 26.6.2). A
  lane's loop over suites wrapped each run in `timeout`, and it read "no result" for every suite: the suite never ran,
  so no `RESULT` line was printed.
- **zsh's `:s` modifier.** In `git show $c:src/middleware/routeAccess.js`, zsh reads `:s` after an unbraced variable as
  its substitute modifier. Reproduced in zsh 5.9: with `c=6ffd0516`, `echo $c:src/middleware/routeAccess.js` prints
  `6ffd0516outeAccess.js`, so git answered "ambiguous argument". `"${c}:src/…"` prints the path as written.
- **The class.** Each is a shell behaviour that changes a command's meaning without an error a session would notice.
  The known siblings are OPEN.md row 237 (zsh's `:t` modifier mangles an unbraced `$TA:slug`; its fix is AGENTS.md's
  handle examples), row 342 (an unquoted path variable makes a negative search vacuous) and row 111 (`PIPESTATUS` is
  empty in zsh; `DONE`).

**Fix shape.**
- **One short "shell traps on this host" list** in the reviewer guidance (`engineering-team/roles/reviewer.md`), or in
  `engineering-team/README.md` § "Running and reading the test gate", which already names one zsh trap (`PIPESTATUS`):
  - brace a variable before a colon: `"${c}:path"`, `"${TA}:slug"`;
  - there is no `timeout`; a lane bounds a run with the tool's own time limit;
  - spell multi-path searches out (row 342).
- Row 342's proposed rule could land in the same list.

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 3 and 9; OPEN.md rows
237, 342 and 111.
