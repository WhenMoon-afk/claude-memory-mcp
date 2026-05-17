# Claude Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local-first memory database and continuity journal for MCP clients.

`claude-memory-mcp` is a basic local memory database and lightweight continuity journal for AI workflows. It helps an agent resume work coherently by saving compact continuity artifacts, tracking key decisions and state, and returning only the level of detail requested instead of dumping a full archive into context.

Use it when you want a local, private continuity store that works across MCP clients and shell scripts. It is intentionally boring infrastructure: SQLite on your machine, one MCP tool, one CLI, explicit import/export, and no hosted service.

- Published package: `@whenmoon-afk/memory-mcp`
- Supported CLI command: `claude-memory-mcp`
- Storage: local SQLite only
- Privacy: no telemetry, no network calls, no cloud service

## Why v3?

The last npm-published v2 release was `2.5.0`. v3 is an intentional product reset: the older identity-oriented `self`, `reflect`, and `anchor` surface is removed, and the project is now focused on simple local continuity.

Client-native memory features are useful when your client provides them, but they are usually client-owned. `claude-memory-mcp` is for a different job: a portable, inspectable, local, private continuity store that you can back up, import, script, and query progressively.

This version is meant to be stable and conservative. It prioritizes clear contracts, local storage, predictable CLI/MCP behavior, and a small public surface that downstream forks can understand.

## What This Is Not

- It is not a cloud memory service.
- It is not a replacement for native client memory.
- It is not a transcript archive.
- It is not an autonomous background recorder.
- It is not a plugin or marketplace package.
- It is not a task tracker, dependency graph, or multi-agent coordination system.

## What It Ships

- One MCP tool: `continuity`
- One mirrored CLI for local scripting and inspection
- Operational CLI commands for `doctor`, `export`, and `import`
- File-based backups with import dry-run validation
- Progressive disclosure by default: compact lists first, full detail only on explicit request
- Five artifact types:
  - `snapshot`
  - `decision`
  - `project_state`
  - `bundle`
  - `meta_snapshot`
- Linked node kinds:
  - `project`
  - `theme`
  - `entity`

## MCP Surface

The server exposes a single dispatch-style tool:

| Action | Purpose |
| --- | --- |
| `help` | Show the supported action surface |
| `save` | Store a new artifact |
| `list` | Return compact recent rows |
| `search` | Search compact rows without expanding bodies |
| `get` | Load one artifact in `compact` or `full` form |
| `neighbors` | Show nearby linked artifacts and nodes |
| `node` | Inspect one node and list linked artifacts |
| `related` | Explain why an artifact is related to nearby artifacts |
| `doctor` | Inspect schema version, integrity, and row counts |
| `bundle` | Build a concise resume bundle for a project |
| `merge` | Synthesize a new artifact from multiple prior artifacts |
| `delete` | Remove an artifact by id |

The tool advertises an SDK input schema so clients can discover the required `action` field. Action-specific fields stay optional at listing time, and the server validates the selected action before dispatch.

Example tool calls:

```json
{"action":"save","type":"snapshot","title":"JWT auth pass","summary":"Middleware works and tests are green","project":"notes-api","themes":["authentication"],"entities":["jwt"],"next_steps":["Add password reset flow"]}
{"action":"search","query":"jwt auth"}
{"action":"get","id":"snap-1","detail":"compact"}
{"action":"node","id":"theme:authentication"}
{"action":"related","id":"snap-1","via":"all"}
{"action":"bundle","project":"notes-api"}
```

## Example Workflow

Record a project decision:

```bash
npx -y @whenmoon-afk/memory-mcp save \
  --type decision \
  --title "Keep auth continuity local-first" \
  --summary "Use SQLite continuity artifacts instead of external sync for auth handoff." \
  --project notes-api \
  --theme authentication \
  --entity sqlite \
  --next "Document restore flow"
```

List compact project context:

```bash
npx -y @whenmoon-afk/memory-mcp list --project notes-api
```

Inspect nearby graph context:

```bash
npx -y @whenmoon-afk/memory-mcp node theme:authentication
npx -y @whenmoon-afk/memory-mcp related dec-1 --via all
```

Create a resume bundle:

```bash
npx -y @whenmoon-afk/memory-mcp bundle --project notes-api
```

Back up and validate the continuity store before replacing anything:

```bash
npx -y @whenmoon-afk/memory-mcp backup --file continuity-backup.json
npx -y @whenmoon-afk/memory-mcp import --file continuity-backup.json --dry-run
```

## CLI

Use `npx` without installing globally:

```bash
npx -y @whenmoon-afk/memory-mcp setup
npx -y @whenmoon-afk/memory-mcp save --type snapshot --title "JWT auth pass" --summary "Middleware works" --project notes-api --theme authentication --entity jwt --next "Add password reset flow"
npx -y @whenmoon-afk/memory-mcp list --project notes-api
npx -y @whenmoon-afk/memory-mcp node theme:authentication
npx -y @whenmoon-afk/memory-mcp related snap-1 --via all
npx -y @whenmoon-afk/memory-mcp doctor
npx -y @whenmoon-afk/memory-mcp backup --file continuity-backup.json
npx -y @whenmoon-afk/memory-mcp export > continuity-export.json
npx -y @whenmoon-afk/memory-mcp import --file continuity-export.json --dry-run
npx -y @whenmoon-afk/memory-mcp import --file continuity-export.json
npx -y @whenmoon-afk/memory-mcp get snap-1 --full
```

The CLI fails closed: unknown commands, unknown flags, missing or extra fixed-arity positionals, and ambiguous `--compact` / `--full` usage exit non-zero with concise help context.

If you install globally, the supported binary is `claude-memory-mcp`:

```bash
npm install -g @whenmoon-afk/memory-mcp
claude-memory-mcp serve
claude-memory-mcp search "password reset"
claude-memory-mcp bundle --project notes-api
claude-memory-mcp doctor
```

Node `20` or newer is the supported runtime for the CLI and MCP server.

## Installation

### Claude Code

```bash
claude mcp add continuity -- npx -y @whenmoon-afk/memory-mcp
```

### Claude Desktop

Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "continuity": {
      "command": "npx",
      "args": ["-y", "@whenmoon-afk/memory-mcp"]
    }
  }
}
```

### Other MCP Clients

Use the same stdio command:

```bash
npx -y @whenmoon-afk/memory-mcp
```

After setup, verify the client can call `continuity` with `{"action":"list"}`.

## Data Storage

Everything stays local. By default the server uses one SQLite database:

| Platform | Default Path |
| --- | --- |
| Linux | `~/.local/share/claude-memory/continuity.db` |
| macOS | `~/.local/share/claude-memory/continuity.db` |
| Windows | `%APPDATA%\\claude-memory\\continuity.db` |

Environment variables:

- `CLAUDE_MEMORY_DATA_DIR`: override the base directory
- `CLAUDE_MEMORY_DB_PATH`: point directly at a database file

When `CLAUDE_MEMORY_DB_PATH` is set, it wins over every directory setting. When
only directory settings are present, `CLAUDE_MEMORY_DATA_DIR` wins first, then a
repo-local `.claude-memory.json` `db_path`, then `XDG_DATA_HOME`, then
`APPDATA`, then the home-directory fallback.

If you want repo-local isolation, either point `CLAUDE_MEMORY_DB_PATH` at a
project-specific path when launching the server or CLI, or add a
`.claude-memory.json` file to the project root:

```json
{"db_path": ".claude-memory/continuity.db"}
```

## Operational Commands

These commands are meant for local maintenance rather than routine in-agent retrieval:

- `claude-memory-mcp doctor`: reports schema version, SQLite integrity, and row counts

These data-transfer commands are CLI-only:

- `claude-memory-mcp export`: writes a versioned JSON export envelope to stdout
- `claude-memory-mcp backup --file <path>`: writes the same export envelope to a file
- `claude-memory-mcp import --file <path> --dry-run`: validates an export envelope without changing the current store
- `claude-memory-mcp import --file <path>`: replaces the current store with a previously exported JSON envelope

The export envelope format id is `claude-memory-continuity-export`. The stable contract for artifacts, graph nodes, operational commands, and schema versioning is documented in [CONTRACT.md](https://github.com/whenmoon-afk/claude-memory-mcp/blob/main/CONTRACT.md).

## Release

The npm package is `@whenmoon-afk/memory-mcp`; the v3 CLI binary is `claude-memory-mcp`. Release and publishing steps are documented in [RELEASE.md](https://github.com/whenmoon-afk/claude-memory-mcp/blob/main/RELEASE.md).

## Product Notes

- This branch replaces the older `self` / `reflect` / `anchor` surface with the `continuity` action model.
- The design goal is simple local continuity: snapshots, decisions, state records, themes, and entities.
- Search and neighbor queries intentionally return compact rows first so agents can inspect nearby context without wasting tokens.
- Shared `theme`, `entity`, and `project` nodes can connect otherwise separate artifacts into a navigable continuity graph.
- `node` and `related` keep the graph inspectable without forcing full graph dumps into context.
- `doctor` is available through MCP and CLI; `export`, `backup`, and `import` are
  CLI-only so data-transfer operations stay explicit and local.

## v3 Migration

`claude-memory-mcp` now exposes a continuity-first API.

Removed:

- `self`
- `reflect`
- `anchor`

Added:

- `continuity` MCP dispatch tool
- `claude-memory-mcp` CLI commands for `save`, `list`, `search`, `get`, `neighbors`, `node`, `related`, `doctor`, `export`, `backup`, `import`, `bundle`, `merge`, and `delete`
- SQLite-backed continuity artifacts for snapshots, decisions, state records, bundles, and meta-snapshots

## Privacy Policy

All data is local to your machine.

- Data collection: none
- Telemetry: none
- Network calls: none
- Third-party sharing: none

Delete the database file to remove stored continuity artifacts.

## Support

- Issues: [github.com/whenmoon-afk/claude-memory-mcp/issues](https://github.com/whenmoon-afk/claude-memory-mcp/issues)
- Repository: [github.com/whenmoon-afk/claude-memory-mcp](https://github.com/whenmoon-afk/claude-memory-mcp)

## License

MIT
