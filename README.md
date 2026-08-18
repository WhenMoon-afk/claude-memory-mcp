# Mooncite

Mooncite gives local coding agents bounded, citation-backed recall from prior Pi sessions. Search returns an exact Mooncite evidence ID and URI; inspection re-verifies the physical JSONL bytes before showing context.

## Install

Requires Node.js 24 or newer.

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.0 install
```

Mooncite 4.0.0 is distributed from the tagged GitHub repository, not the npm registry.

A fresh install places a stable package under `$XDG_DATA_HOME/mooncite` (default `~/.local/share/mooncite`), builds the index under `$XDG_STATE_HOME/mooncite` (default `~/.local/state/mooncite`), and configures every supported client found on the machine:

- Pi: packaged thin extension
- Oh My Pi (OMP): packaged `.mcp.json` pointing to the same local stdio server
- Codex: local stdio MCP registration
- Claude Code: local stdio MCP registration

Unavailable clients are reported and left untouched. Conflicting `mooncite` registrations are refused rather than overwritten.

## Tools

Mooncite exposes exactly three MCP tools:

- `mooncite_recall` — bounded lexical search over authorized local Pi history
- `mooncite_inspect` — verify an evidence ID or URI and return a bounded physical source window
- `mooncite_status` — report source, index, freshness, coverage, and registration health without transcript text

Use recall first, then inspect the returned `mooncite:pi:…` ID or `mooncite://pi/…` URI before relying on the evidence.

## Operations

```bash
mooncite status
mooncite rebuild
mooncite disable
mooncite uninstall
mooncite purge
mooncite purge --yes
mooncite serve
```

`disable` removes exact registrations only. `uninstall` also removes the recognized stable package. Both preserve source history and the evidence index. `purge --yes` separately removes only recognized derived-state files and refuses unknown entries. Mooncite has no updater or in-place cross-version upgrade path; uninstall another version with that version's executable, then install 4.0.0 fresh.

## Privacy boundary

Mooncite is local and read-only with respect to Pi session files. Recall returns bounded excerpts; inspect returns a bounded verified window. Text sent through an MCP tool becomes model context and is then subject to that model provider's data handling. Mooncite does not upload history itself.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [operations](docs/operations.md), and [security](docs/security.md).

Repository: <https://github.com/WhenMoon-afk/claude-memory-mcp>
