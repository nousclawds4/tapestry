# Three live tests still expect 404 for an unregistered `/api` route, which the route table's default-deny has answered 401 since `151e39fb`

**Id:** 2026-10-28-live-tests-expect-404-not-401
**Type:** bug
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, "Outside this story" 1)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The rule they predate.** Since `151e39fb` (authored 2026-10-10, story `security-auth-exposure` #8, ADR
  `security-auth-exposure/0005`) the access check refuses any route the route table does not open. A path with no entry
  is the owner's side's (`src/middleware/routeAccess.js:547`), so a signed-out request gets 401 before Express can
  answer 404 (`src/middleware/auth.js:385-405`). Only a direct loopback request skips the check (`auth.js:367-368`).
- **The three tests.** Each sends a signed-out host-side GET to a path that is meant not to exist, and asserts 404:
  - `test/nip51-list-export-from-pins.test.js:194-205`, "/api/config/public-relay must NOT be introduced";
  - `test/relationship-primitives-probe.test.js:314` (H2), the unregistered sibling
    `/api/normalize/relationship-primitives-missing-sibling`, which must also answer Express's "Cannot GET" page;
  - `test/teach-it-what-matters.test.js:761` (H6), its second half: `/api/brain/signals` must answer 404.
- **Why they were green until now.** This host's backend ran from 2026-10-02 until a restart on 2026-10-28, so it
  served the middleware from before `151e39fb`. The story 6 review's full gate, the first after the restart, failed all
  three (run `20261028T154319Z-13921-dcd1`). `resolveRouteAccess('GET', …)` gives `owner` for all three paths. CI
  does not see it: its job is stack-free, so these live tests skip there.
- **No route was added.** The tests' intent still holds; only the signal they read has changed.

**Fix shape.**
- **Ask the router, not the access check.** "This route is not registered" can be read from the stack-free router walk
  (`test/helpers/routeWalk.js`, which `test/admin-action-sweep.test.js` already uses). That keeps the pin with no stack.
- **Or ask from where the check is skipped.** A loopback request inside the container still reaches Express's 404.
- **H2 is about the visible contrast,** so it may instead compare the sibling's default-deny answer (401 JSON with the
  route table's message) with the probe's 200.
- The tests are the Tester's, so the change is a small bug story (Test Design, then Review), not an edit in passing.

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Quality gates and § "Outside this story"
1; ADR `tagging-edges/0006` § Seams, "Live and evidence" (the 404-to-401 note); ledger
`2026-10-11-route-table-release`.
