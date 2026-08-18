# Operations

## Install

Tagged v4.0.4 is the current stable release and is distributed from GitHub rather than the npm registry:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.4 install
```

The untagged `main` branch is 4.0.5 prerelease development, identified by commit SHA. It does not yet have a stable v4.0.5 install tag.

`mooncite install` stages its own package, verifies the exact name, version, and layout, atomically places a fresh package under `$XDG_DATA_HOME/mooncite`, creates an exact `~/.local/bin/mooncite` link, refreshes the evidence index, and adds missing registrations for available Pi, OMP, Codex, and Claude Code clients. Repeating the same installed version is idempotent. A missing registration-ownership journal can be recreated only when all four client states are available to diagnose; otherwise install refuses to guess ownership.

Fresh installs report unavailable clients and leave them untouched. If an existing package needs ownership-journal repair, make every unavailable client state diagnosable and rerun install. A conflicting registration, different-version or unrecognized install tree, and unrelated launcher command are refused; there is no force-overwrite flag. Resolve the reported ownership or registration conflict, then rerun the same command.

The launcher directory is fixed at `~/.local/bin` even when XDG data/state locations are customized. If it is not on `PATH`, invoke `"$HOME/.local/bin/mooncite"` directly or add `export PATH="$HOME/.local/bin:$PATH"` to the appropriate shell startup file.

After install or reinstall, fully restart or reload every configured client before trusting Mooncite tool results. Already-running clients and MCP child processes are not guaranteed to hot-reload.

## Conversation sources

Pi and OMP roots follow their client environments:

- Pi: `$PI_AGENT_DIR/sessions`, defaulting to `~/.pi/agent/sessions`
- OMP: `$PI_CODING_AGENT_DIR/sessions`, defaulting to `~/.omp/agent/sessions`

By default, Mooncite also checks these narrow optional locations:

- Claude Code: `~/.claude/projects` and `~/.config/claude-sol/projects`
- Codex CLI: `$CODEX_HOME/sessions`, defaulting to `~/.codex/sessions`
- ChatGPT archives: `~/incoming/chatgpt-share-archive`

`MOONCITE_AUTO_SOURCES=0` disables all three automatic optional origins for a process started with that environment. Changing the variable in another shell does not alter an already-running MCP process. An explicit registration overrides every automatic root for that origin:

```bash
mooncite source list
mooncite source add claude-code /absolute/path/to/claude-projects
mooncite source add codex /absolute/path/to/codex-sessions
mooncite source add chatgpt /absolute/path/to/extracted-chatgpt-exports
mooncite rebuild
```

Mooncite stores configured roots in `$XDG_CONFIG_HOME/mooncite/sources.json` with owner-only permissions. `source add` requires an existing absolute normalized directory with no symbolic-link component and does not copy source files. It refuses a second configured root for the same origin; remove the old override before adding a different one. `source list` reports automatic, configured, and effective roots separately. Long-lived MCP servers re-read the configuration on the next recall or status refresh, but client registration or executable changes still require a client restart or reload.

Remove a configured override without deleting its history:

```bash
mooncite source remove claude-code
mooncite source remove codex
mooncite source remove chatgpt
mooncite rebuild
```

Removing an override may reactivate the automatic root for that origin. Use `MOONCITE_AUTO_SOURCES=0` when no automatic optional histories should be indexed.

ChatGPT conversations are account-backed rather than a supported local desktop transcript store. Request the official export under **ChatGPT Settings → Data controls → Export**, extract it into the automatic archive directory or an explicitly registered root, then rebuild. Mooncite scans `conversation.json`, `conversations.json`, and numbered `conversations-N.json` files containing either one conversation object or a top-level array. It does not automate account login or export requests.

For remote histories, first create an owner-controlled local snapshot or read-only mount using tools outside Mooncite. Mooncite has no SSH credentials, network transport, or remote-copy command.

## Status and rebuild

`mooncite status` incrementally refreshes all authorized sources and reports health, per-origin counts, and Pi/OMP/Codex/Claude Code registration states. `mooncite rebuild` performs a complete verified read. Neither command changes source history, client registrations, or optional-source authorizations.

## Disable, uninstall, purge, and version changes

`mooncite disable` removes only client registrations recorded as owned by this installation. It preserves the package, exact launcher, `$XDG_STATE_HOME/mooncite`, `$XDG_CONFIG_HOME/mooncite/sources.json`, and every source file.

`mooncite uninstall` removes owned registrations, the recognized stable package, and the exact launcher link when present. It preserves the evidence index, source configuration, and source history. An unavailable unowned client does not block cleanup, but an exact or conflicting unowned registration does: it may still target the package, so uninstall refuses to orphan it. An unavailable owned registration or any owned removal that cannot be verified also causes refusal and leaves the package in place for a safe retry.

After disable or uninstall, fully restart or reload affected clients so a previously loaded extension or MCP child process stops exposing Mooncite.

`mooncite purge` lists recognized state entries and requires `--yes` before deletion. Its allowlist is the Mooncite state marker, SQLite database and sidecars, and stale Mooncite engine-lock files. It refuses unknown entries, directories, symbolic or hard links, invalid ownership, overlapping or aliased source/state roots, and any live engine. Purge removes the derived-state directory, but never the source configuration or source history.

To remove Mooncite-owned registrations, derived state, launcher, and package while retaining source configuration and history:

1. Run `mooncite disable`.
2. Fully exit or reload every affected client so its Mooncite engine stops.
3. Run `mooncite purge --yes`.
4. Run `mooncite uninstall`.

There is no updater or in-place cross-version replacement. Use the launcher belonging to the installed version to run `uninstall`, run the tagged v4.0.4 install command above, then restart or reload configured clients. Do not substitute `#v4.0.5` while 4.0.5 remains untagged prerelease development.

A marked, owner-private but corrupt or incompatible SQLite index is disposable and rebuilt from unchanged sources. An unmarked state directory is adopted only when its private allowlisted files and SQLite metadata identify it as Mooncite-owned; otherwise startup refuses it.
