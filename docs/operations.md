# Operations

## Install
Mooncite 4.0.4 is distributed from GitHub rather than the npm registry:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.4 install
```


`mooncite install` stages the current package, verifies exact name/version/layout, atomically places a fresh package under `$XDG_DATA_HOME/mooncite`, creates an exact `~/.local/bin/mooncite` link, refreshes the evidence index, and adds missing registrations for supported clients that are available. A conflicting registration, different package, or unrelated command at the launcher path is refused. Repeating 4.0.4 is idempotent and repairs its registration-ownership journal.

## Conversation sources

Pi and OMP use their standard local session roots. By default, Mooncite also checks these narrow locations automatically:

- Claude Code: `~/.claude/projects` and `~/.config/claude-sol/projects`
- Codex CLI: `~/.codex/sessions` (or `$CODEX_HOME/sessions`)
- ChatGPT archives: `~/incoming/chatgpt-share-archive`

`MOONCITE_AUTO_SOURCES=0` disables all three automatic optional origins. An explicit registration overrides the automatic root for that origin:

```bash
mooncite source list
mooncite source add claude-code /absolute/path/to/claude-projects
mooncite source add codex /absolute/path/to/codex-sessions
mooncite source add chatgpt /absolute/path/to/extracted-chatgpt-exports
mooncite rebuild
```

Mooncite stores configured roots in `$XDG_CONFIG_HOME/mooncite/sources.json` with owner-only permissions. `source add` does not copy source files. `source list` reports automatic, configured, and effective roots separately. Long-lived MCP servers observe root changes on their next request.

Remove a configured override without deleting its history:

```bash
mooncite source remove claude-code
mooncite source remove codex
mooncite source remove chatgpt
mooncite rebuild
```

Removing an override may reactivate the automatic root for that origin. Use `MOONCITE_AUTO_SOURCES=0` when no automatic optional histories should be indexed.

ChatGPT conversations are account-backed rather than a supported local desktop transcript store. Request the official export under **ChatGPT Settings → Data controls → Export**, extract its JSON into the automatic archive directory or an explicitly registered root, then rebuild. Mooncite does not automate account login or export requests.

For remote desktop histories, first make an owner-controlled local snapshot or read-only mount using tools outside Mooncite. Verify copied files against the remote SHA-256 before using the local snapshot root. Mooncite deliberately has no SSH credentials, network transport, or remote-copy command.

## Status and rebuild

`mooncite status` incrementally refreshes all authorized sources and reports health and per-origin counts. `mooncite rebuild` performs a complete verified read. Neither command changes source history, client registrations, or optional-source authorizations.

## Disable, uninstall, purge

`mooncite disable` removes only client registrations recorded as owned by this Mooncite installation. `mooncite uninstall` also verifies and deletes the exact command link and stable package. An unavailable unowned client does not block either operation; an unavailable owned client preserves the package for retry. Both retain `$XDG_STATE_HOME/mooncite`, `$XDG_CONFIG_HOME/mooncite/sources.json`, and every source history file.

`mooncite purge` lists recognized derived files and requires `--yes`. Purge requires the owner marker and accepts only the SQLite database and its SQLite sidecars; unknown files, directories, symbolic links, and hard links cause refusal. Source history lives outside the state root and is never a purge target.

Use the executable matching an installed older version to uninstall its package, then install 4.0.4 fresh. Mooncite safely recognizes and adopts a private, schema-identified pre-marker Mooncite index retained by 4.0.0; incompatible derived state is rebuilt from unchanged source history.
