# Mooncite

Mooncite gives local coding agents bounded, citation-backed recall from authorized Pi, OMP, Claude Code, Codex, and ChatGPT conversation history. Search returns an exact Mooncite evidence ID and URI; inspection re-verifies the physical source bytes before showing context.

## Install

Requires Linux with procfs and Node.js 24 or newer. Mooncite fails closed when it cannot pin authorized source roots through Linux file descriptors.

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.3 install
```

Mooncite 4.0.3 is distributed from the tagged GitHub repository, not the npm registry.

A fresh install places a stable package under `$XDG_DATA_HOME/mooncite` (default `~/.local/share/mooncite`), builds the index under `$XDG_STATE_HOME/mooncite` (default `~/.local/state/mooncite`), automatically discovers supported histories in narrow standard locations, and configures every supported client found on the machine:

- Pi: packaged thin extension
- Oh My Pi (OMP): packaged `.mcp.json` pointing to the same local stdio server
- Codex: local stdio MCP registration
- Claude Code: local stdio MCP registration

Unavailable clients are reported and left untouched. Conflicting `mooncite` registrations are refused rather than overwritten.

Pi and OMP use their standard session roots. Mooncite automatically discovers `~/.claude/projects`, `~/.config/claude-sol/projects`, `~/.codex/sessions`, and an existing `~/incoming/chatgpt-share-archive`. Explicit `source add` registrations override the automatic root for that origin; `MOONCITE_AUTO_SOURCES=0` disables all automatic optional-source discovery.

## Tools

Mooncite exposes exactly three MCP tools:

- `mooncite_recall` — bounded lexical search over authorized local session history
- `mooncite_inspect` — verify an evidence ID or URI and return a bounded physical source window
- `mooncite_status` — report source counts by origin, index freshness, coverage, and registration health without transcript text

Use recall first, then inspect the returned `mooncite:<origin>:…` or `mooncite://<origin>/…` locator before relying on the evidence. Origins are `pi`, `omp`, `claude-code`, `codex`, and `chatgpt`.

## Operations

```bash
mooncite status
mooncite rebuild
mooncite source list
mooncite source add claude-code /absolute/path/to/projects
mooncite source add codex /absolute/path/to/sessions
mooncite source add chatgpt /absolute/path/to/extracted-exports
mooncite source remove claude-code
mooncite source remove codex
mooncite source remove chatgpt
mooncite disable
mooncite uninstall
mooncite purge
mooncite purge --yes
mooncite serve
```

`source list` distinguishes automatic and configured roots. `source add` records an explicit local override; it does not copy history. `source remove` removes that override, not its files, so an available automatic root may become active again. `disable` removes exact client registrations only. `uninstall` also removes the recognized stable package. Both preserve source history, source authorizations, and the evidence index. `purge --yes` separately removes only recognized derived-state files and refuses unknown entries. Mooncite has no updater or in-place cross-version upgrade path; uninstall another version with that version's executable, then install 4.0.3 fresh.

## ChatGPT desktop conversations

The ChatGPT desktop apps use the same account-backed conversation service as ChatGPT on the web; Mooncite does not scrape app caches, browser cookies, or credentials. Request the supported data export in ChatGPT under **Settings → Data controls → Export**, extract it into `~/incoming/chatgpt-share-archive` (or register its parent directory with `source add chatgpt`), then run `mooncite rebuild`. Mooncite accepts single `conversation.json` archives and top-level `conversations.json` arrays.

## Privacy boundary

Mooncite is local and read-only with respect to every source file. Automatic discovery is limited to the named standard roots and can be disabled with `MOONCITE_AUTO_SOURCES=0`. Recall returns bounded excerpts; inspect returns a bounded verified window. Text sent through an MCP tool becomes model context and is then subject to that model provider's data handling. Mooncite does not upload history, request ChatGPT exports, or invoke SSH; remote history must first be copied or mounted into a local root.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [operations](docs/operations.md), and [security](docs/security.md).

Repository: <https://github.com/WhenMoon-afk/claude-memory-mcp>
