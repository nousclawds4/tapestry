# Tapestry — Agent Guide

This file is for AI agents working on the Tapestry codebase. Read it before doing anything else.

---

## 1. Find the local instance's port and TA pubkey first

The control panel API runs on a port set by `CONTROL_PANEL_PORT` in `/etc/brainstorm.conf` (a Tapestry deployment generates this from `config/brainstorm.conf.template` at first container startup). The template does not set it, so the code default `7778` (`bin/control-panel.js`) applies — but **don't assume it**: different deployments and dev setups override it. Find it before you start:

```bash
# Preferred — the running config
grep -E '^export CONTROL_PANEL_PORT=' /etc/brainstorm.conf 2>/dev/null \
  || grep -E 'CONTROL_PANEL_PORT' bin/control-panel.js   # code default: 7778
```

Set it as an env var for the rest of the session so the examples below work:

```bash
export TAPESTRY_PORT=<the value you found>
```

You will also need the **Tapestry Assistant (TA) pubkey** for this instance. Every concept graph handle has the form `kind:pubkey:slug`, and the pubkey is always the local TA. Get it once:

```bash
curl -s http://localhost:$TAPESTRY_PORT/api/assistant/pubkey
```

The TA is per-deployment — created at first container startup by `setup/create_nostr_identity.sh` and stored as `tapestry-assistant`. Never hardcode the value. Each developer's local stack mints its own, so a doc that records something seen on "localhost" (an ADR, a ledger row, a handoff) may describe another machine's stack: before trusting it, or concluding that something vanished here, check that the TA pubkey inside its handles is yours.

---

## 2. Orient: probe the graph, then follow the ladder

**The card (works with no stack):** Tapestry = strfry (nostr events) + Neo4j (concept graph + WoT) + Meilisearch (search docs) + a Node control panel (API + UI), all in Docker. Domain knowledge lives in the **concept graph** when the stack is up, and in `firmware/*.json` + BIBLE.md when it isn't. Key directories: `src/` (server), `ui/` (React), `engineering-team/` + `product-team/` (process harness), `protocols/` (specs), `scripts/` (harness tooling). Process rules: CLAUDE.md's pointer table.

**Probe once (≤2s)** — before reading source files or BIBLE.md:

```bash
curl -sf -m 2 http://localhost:$TAPESTRY_PORT/api/concept-graph/summaries
```

**Probe succeeds — stack present:** the summaries are a compact picture of the entire domain in ~3k tokens. Each entry has: `handle`, `name`, `description` (~1 sentence), `elementCount`, `setCount`. Scan these to identify the 1–3 concepts relevant to your task. Then stop — do not load more until you need it. Continue with §3; the "don't load BIBLE.md / firmware" rule (§4) applies **only on this branch**.

**Probe fails — stack absent (web/remote/CI sessions):** fall back down the ladder: orient from `firmware/*.json` (the concept definitions the graph is built from), then BIBLE.md §5–§9 via its table of contents for architecture context. **Unavailable this session:** firmware install (§6), `/cycle-local` smoke tests, anything else needing `localhost:$TAPESTRY_PORT`. State which branch you're on early — don't guess at graph state you can't see.

---

## 3. The three-call pattern

**Step 1 — orient (always):**
```bash
GET /api/concept-graph/summaries
```
Read all concept names + descriptions. Identify the 1–3 concepts relevant to your task.

**Step 2 — inspect (when you need structure):**
```bash
GET /api/concept-graph/node/:handle/neighbors
```
One-hop view. Shows all connected nodes grouped by relationship type (IS_THE_JSON_SCHEMA_FOR, IS_THE_CONCEPT_FOR, HAS_ELEMENT, etc.) — as summaries, not full content. Use this to understand what's wired to a concept without loading everything.

**Step 3 — read (when you need content):**
```bash
GET /api/concept-graph/node/:handle
```
Full node content including the `json` tag (word-wrapper format with schema, properties, description). Only call this for nodes you've already identified as directly relevant.

---

## 4. What NOT to do

**Don't use `/subgraph` with depth > 1** unless you specifically need a nested tree structure. Depth 2 pulls in hundreds of nodes and is almost always more than you need.

**Don't load BIBLE.md or firmware JSON files** to understand a concept that's already in the graph — *when the graph is reachable* (§2's success branch). The graph is the authoritative, queryable form of that knowledge. On the stack-absent branch, firmware + BIBLE **are** the sanctioned path.

**Don't call `/neighbors` on every node you encounter.** Follow the handle only when a neighbor is relevant to your task.

**Don't hardcode the port or TA pubkey.** Discover both per §1.

**Don't run a test suite as `node test/<suite>.test.js`.** 144 of the 319 suites (2026-10-29) export `run()` with no `require.main` block, so that loads the file and exits 0 having run nothing (OPEN.md row 310); `npm test -- <file>` runs every suite instead. Call `run()`: [README § Running and reading the test gate](./engineering-team/README.md#running-and-reading-the-test-gate).

---

## 5. Handle format

Handles are stable Neo4j node UUIDs in the format `kind:pubkey:slug`:
- `39998:<TA pubkey>:nostr-relay` — a ConceptHeader (kind 39998)
- `39999:<TA pubkey>:nostr-relay-schema` — a core node (kind 39999)

The `pubkey` segment is always this instance's TA pubkey (see §1). Once you have it, you can construct handles deterministically from slugs. In a shell, brace the variable that holds the TA pubkey: `"39998:${TA}:tapestry-assistant"`. zsh reads an unbraced `$TA:` followed by one of `a c e h l q r s t u A P Q` as a modifier on `$TA` and mangles the handle (`…apestry-assistant`), and the API answers 200 with empty neighbors (OPEN.md row 237). Brace git refspecs the same way: `"${SHA}:refs/heads/<branch>"`.

---

## 6. Server

The control panel API runs at `http://localhost:$TAPESTRY_PORT` (per §1). All concept-graph endpoints are read-only GETs.

To reinstall firmware after adding new concept definitions:
```bash
curl -X POST http://localhost:$TAPESTRY_PORT/api/firmware/install
```
