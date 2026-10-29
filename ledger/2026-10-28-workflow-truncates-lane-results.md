# A multi-lane workflow cut the combined lane results at a fixed length, so the review's writer never saw one lane's findings

**Id:** 2026-10-28-workflow-truncates-lane-results
**Type:** meta
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 1)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The run.** Story 6's review ran as a workflow: six read-only lanes and a gate runner, a verifier for each finding,
  then one writer that consolidates them into the review file (review `:15-24`).
- **The cut.** The workflow joined the results into one text and truncated it at a fixed length before handing it to
  the writer. The docs-and-records lane's 12 findings, and two verifiers' verdicts (on that lane's findings, and on
  SEC-1 and SEC-2), did not reach the writer. Both verifiers had run: they left scratch probes, and their full results
  were in the run's output.
- **Where the cut was made.** It was the orchestrating script's own fixed-length slice of the combined results, and the
  orchestrator wrote that script. So the fix is in how workflows hand results over.
- **How it was caught.** The orchestrating Reviewer read the docs lane's full results and verdicts from the run before
  the review was committed. It re-read the cited lines for blocking 2 and requested changes 12 and 15, and folded all
  12 in (blocking 2, requested changes 12-16, and six duplicates; review `:29-31`, `:417-422`). The writer re-ran the
  security verifier's probes for SEC-1 and SEC-2, and both reproduce (review `:26-27`).

**Fix shape.**
- **Hand each result over whole.** Each lane writes its result to its own scratch file, and the writer gets the paths,
  not a joined and clipped text.
- **Or stop when it cannot.** A workflow that must clip says so in the writer's input, names what was cut, and fails
  rather than going on.
- **Name the lanes.** The writer's input lists every lane and verifier it should have heard from, so a missing one is
  seen.
- Workflow scripts live outside the repo, so the durable home for the rule is wherever the harness describes parallel
  review lanes. None does yet; ledger `2026-10-11-reviewer-dispatch-tools-and-commit` meets the same gap from the commit
  side.

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 1.
