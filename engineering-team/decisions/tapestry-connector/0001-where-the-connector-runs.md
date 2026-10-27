# ADR 0001: Where the Tapestry connector runs

**Status:** Proposed
**Date:** 2026-10-27
**Story:** `docs/loom/A6.1.md` (the connector's spec; its stories follow this decision)

## Context

The Tapestry connector gives the team's Claudes the protocol and its list tools in one place (`docs/loom/A6.1.md`). Before its stories can name their repos, someone has to decide where its code runs. The facts:

- **It is a server that runs all the time.** A remote MCP connector answers each tool call, checks who is signed in, and runs the list checks. Claude chat reaches one only through OAuth. Static hosting (GitHub Pages, or a static site behind nginx) runs nothing per request, so it cannot host one.
- **The list code is portable, but it needs a build to leave Brainstorm-UI.** The code it must call, `listCheck` and `listImport` and what they import, is 17 modules in Brainstorm-UI's `client/src/lib/`. They use no browser globals, and their only outside imports are `nostr-tools` and `config/dictionary`. But they import through Vite's `@/` alias with no file extensions, and the config they reach reads JSON files and runtime env when it loads. So they run as they are under Vite (`vite-node`, as Brainstorm-UI's `docs/dictionary/building-lists-with-claude.md` does). Anywhere else needs a build: one ES module with the aliases resolved and the env supplied.
- **Brainstorm-UI has no server.** It ships as static files behind nginx, and the team deploys it through its cluster.
- **Loom already runs a remote connector.** Loom is the team's private portal. Its connector already has:
  - an OAuth authorization server whose tokens are bound to one resource and carry a level the person picks on a consent page;
  - sign-in that admits only the team;
  - tools grouped by level, and guide topics served from a file;
  - a GitHub client that counts its requests against a budget the team's account shares;
  - a deploy on every merge to its main.

  It runs TypeScript on Node 24 with no build step.
- **v1 is for the team, the same people Loom serves.** Later the protocol layer opens to outside curators and their agents, without the team's own process.

## Options considered

### Option A — Inside Loom's connector

The connector's tools and topics join Loom's existing connector as their own group, behind a permission of their own.

- **Pros.** Sign-in, OAuth for Claude chat, levels, guide topics, the request budget and the deploy all exist already. A teammate who connected Loom ticks one more box instead of adding a second connector. The audience is the same.
- **Cons.** Loom grows past its task board. The code lands in Loom's repo, beside the work on Loom's own features, and a Loom outage takes both down. A public version has to move out.

### Option B — Brainstorm-UI, with a server added

A server beside the list code, at a public name such as `brainstorm.world/mcp/tapestry`.

- **Pros.** The list code imports as it is, and changes to it and to the connector are tested together. The public name fits the later open version.
- **Cons.** It needs a new server image and a route in front of the static site, deployed through the cluster. OAuth and team sign-in have to be built from scratch or borrowed from Loom. And a team-only tool sits in the production UI repo.

### Option C — A repo of its own, with Loom as its sign-in

A private service at a name such as `mcp.brainstorm.world/tapestry`.

- **Pros.** Clean separation. It is private, and it can open up on its own later.
- **Cons.** The most work. It needs a new host, deploy and monitoring. Loom has to change so it issues tokens for a second resource and lets the service check them. And it still needs the same list-code build as Option A.

### Option D — A local package each teammate runs

A stdio server run with `npx`.

- **Pros.** No hosting and no OAuth.
- **Cons.** It never reaches Claude chat, which the spec's done-when needs. Each teammate needs their own GitHub access to read the sources.

## Decision

We chose **Option A**: v1 runs inside Loom's existing connector, as its own tool group behind a permission of its own. The two hard parts of a team-only remote connector are sign-in that knows the team and OAuth that Claude chat accepts, and both exist only in Loom. The list code is portable enough to be used from a pinned build.

- **One connector.** The address stays Loom's. Tools and topics are named `tapestry_…`.
- **A scope of its own, not a third level.** Loom's two levels, "Read and propose" and "Work the board", are nested rungs a person picks one of. Tapestry access cuts across both, so it is a separate scope (`tapestry`). The person ticks it on Loom's consent page beside the level they pick, and it works with either level. Each Tapestry tool checks for the scope itself, and its refusal names the scope.
- **The same rules, pinned.** Brainstorm-UI builds its list modules into one ES module at a known commit, and Loom imports that file and records the commit it came from. Moving to a newer commit is a pull request. The connector never keeps its own copy of the rules.
- **Sources read when asked.** Each topic is read from GitHub at request time, from the branch its source names, cached for minutes, under Loom's request budget.
- **Built to move out.** The tools live in a folder of their own in Loom and call no board code. They reach Loom only through its sign-in, its guide machinery and its GitHub client, so they can leave whole.

**When the protocol layer opens** to outside curators and their agents, the tools move out of Loom into a public service of their own. It gets a public name, such as `brainstorm.world/mcp/tapestry` or `mcp.brainstorm.world/tapestry`, and a sign-in that does not depend on being on the team. The team's own process stays behind Loom's sign-in. Moving out is a decision of its own, taken when that time comes; this one keeps the door open.

**The architecture invariants.** The team gate decides who uses a team tool, never what anyone may publish. The connector publishes nothing and holds no key, so decentralized-first and filter-at-view-time stand as they are. The open version drops the team gate.

## Consequences

- **Enables.** One connector and one sign-in for the team, with nothing new to host or deploy. The protocol, the conventions and the checks reach Claude Code and Claude chat alike.
- **Constrains.**
  - Loom's job grows from the task board to the team's tools, and so does its blast radius.
  - The build stories land in Loom's repo and are sequenced with the work on Loom's own features.
  - Brainstorm-UI keeps a build target that other code depends on, so changing its list modules' exports is a change to a contract.
  - A connection made before the scope exists carries no Tapestry access. Its person reconnects to tick it.
- **New debt and follow-ups.**
  - A Brainstorm-UI story to build the list modules as one ES module, and to check that build in its CI.
  - A pinned commit to keep current.
  - A home for the team's list process that Loom can read.
  - The move out, and a public name, when the protocol layer opens.
- **Firmware reinstall required?** No. No concept definitions change.

## Implementation notes

- **Loom.**
  - A folder for the connector's tools, for example `server/tapestry/`. Loom's shared connector files change by a registration line in its tool list and a line in the server's instructions, so work on Loom's own connector features and this work rebase cleanly.
  - The `tapestry` scope: added to the scopes Loom's OAuth supports, to the consent page as a box beside the level, and to the pages that show a connection. The board's level check reads only `loom:work`, so it is unchanged.
  - A topic config listing each source: repo, path, branch, and how it splits into topics. `BIBLE.md` splits by its `##` sections, and the protocol drafts and specs by file.
  - Topics from sources other than Loom's own CLAUDE.md need a loader of their own and a test of their own. Loom's guide reads only CLAUDE.md today, and its tests hold every topic to a section there.
  - Every request-time GitHub read goes through Loom's GitHub client, so it counts against the shared request budget Loom already tracks.
- **Brainstorm-UI.**
  - A build target, such as Vite's library mode, that writes the list modules and the config they read as one ES module, with env supplied by the caller.
  - A test that the built module's `listCheck` gives the same results as the source's own, on its existing fixtures.
- **The team's list process.** Its natural home is a file in Loom's own repo, which is private. Loom reads it there with no GitHub request.

## Out of scope

- The stories and their order. The breakdown follows this ADR.
- Which sources come first, and the topic list.
- The public service: its design, name and sign-in, decided at the move out.
- Search tools for agents.
