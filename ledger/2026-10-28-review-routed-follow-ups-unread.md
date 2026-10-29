# A review's "goes to story N" follow-up has no surface that story N's Planning reads, so one was dropped

**Id:** 2026-10-28-review-routed-follow-ups-unread
**Type:** meta
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 6)
**Status:** OPEN
**Done:** —

**What was seen.**
- **The routing.** Review 5's round-1 non-blocking 1 (focus is not returned when the off prompt closes) said "It is
  optional in this round, and otherwise goes to story 6" (`5-real-time-path-switch.md:207-211`).
- **The drop.** Story 6's Planning took the carry-forwards the owner placed at review 5's round 2, C5-1 to C5-10
  (story 6 § "Carry-forwards from story 5's review"). The round-1 item was not among them, and nothing else pointed at
  it. Story 6's new Stop prompt then repeated the gap. The bug itself is ledger `2026-10-28-panel-prompts-return-no-focus`.
- **Why it slipped.** "Goes to story N" lives only in the review's text. The Planning workflow does not ask the Product
  Owner to read the prior story's review for items routed forward, and `/whats-open` does not list them.
- **A sibling that is closed.** Ledger `2026-09-20-carry-forward-register-never-ticked` (`DONE`, PR #706) fixed the
  book-close register in `/whats-open`. That covers a book's audit §6, not a review's per-story routing.

**Fix shape.**
- **File it, or don't route it.** A review that routes a follow-up to a later story also files a ledger row (or an
  epic note) naming that story, so the item has a surface.
- **Or have Planning read back.** `workflows/1-planning.md` gains one step: read the previous story's review for
  "goes to story N" items and list each in the story, as carried or as declined.
- Either way, the review template's Non-blocking section could ask where each item goes.

**Pointer:** `engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 6;
`engineering-team/stories/tagging-edges/6-pass-run-and-stop.md` § "Carry-forwards from story 5's review".
