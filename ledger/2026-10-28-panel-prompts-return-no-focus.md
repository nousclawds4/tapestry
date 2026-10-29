# The tagging panel's two prompts move focus to Cancel when they open and return it nowhere when they close

**Id:** 2026-10-28-panel-prompts-return-no-focus
**Type:** bug
**Opened:** 2026-10-28 (tagging-edges #6 review, round 1, Harness friction 6; first seen in story 5's review)
**Status:** OPEN
**Done:** —

**What was seen.**
- **Story 5's off prompt.** `OffPrompt` (`ui/src/pages/settings/taggingPipeline/PathSwitch.jsx:51-55`) focuses Cancel in
  an effect when it opens. Nothing returns focus when it closes. Review 5's round-1 non-blocking 1 named this, citing
  the prompt's self-close effect (`PathSwitch.jsx:113-115` then, `:117-119` now), and said it "otherwise goes to
  story 6".
- **Story 6's Stop prompt** repeats the gap. `StopPrompt` (`ui/src/pages/settings/taggingPipeline/PassControls.jsx:44-47`)
  focuses Cancel on open, and neither file has any other focus call.
- **The effect.** After Cancel, or when a prompt closes by itself, the control it replaced is unmounted, so focus falls
  to the page body. A keyboard or screen-reader person has to find their place again.
- Story 6's Planning carried only round 2's C5-1 to C5-10, so the round-1 item reached no story. The routing gap is
  ledger `2026-10-28-review-routed-follow-ups-unread`.

**Fix shape.**
- **After Cancel,** return focus to the control that opened the prompt ("Turn off", or "Stop").
- **After a prompt closes by itself** (the path changed, the stop finished, or the busy passes it showed are gone),
  focus something that sends nothing: the outcome line, or the section heading. Never "Turn on", which sends without
  a prompt.
- **Add a browser test for each prompt,** next to the specs that already check focus on open.

**Pointer:** `engineering-team/reviews/tagging-edges/5-real-time-path-switch.md:207-211` (non-blocking 1);
`engineering-team/reviews/tagging-edges/6-pass-run-and-stop.md` § Harness friction 6.
