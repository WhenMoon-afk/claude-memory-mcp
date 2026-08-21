# Operations

## Install

Mooncite requires Linux with procfs, Node.js 24 or newer, `npm`, and access to GitHub.

Stable v4.0.5:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.5 install
```

Current prerelease:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.6-preview.1002.0 install
```

The prerelease tag does not replace the stable tag. Untagged `main` builds are identified by commit SHA.

The installer verifies the package identity and layout. It puts the package under `$XDG_DATA_HOME/mooncite` and the evidence index under `$XDG_STATE_HOME/mooncite`. It creates `~/.local/bin/mooncite` and configures available Pi, OMP, Codex, and Claude Code clients. Reinstalling the same version is idempotent.

Mooncite refuses conflicting registrations, unrelated launcher commands, unsafe paths, and unrecognized or different-version install trees. It has no force-overwrite option.

After installation, check the result:

```bash
"$HOME/.local/bin/mooncite" status
```

Use a client only when its registration is `exact`. Fully restart or reload every configured client after install or reinstall.

## Conversation sources

Pi and OMP use their client roots:

- Pi: `$PI_AGENT_DIR/sessions`, default `~/.pi/agent/sessions`
- OMP: `$PI_CODING_AGENT_DIR/sessions`, default `~/.omp/agent/sessions`

Mooncite also checks these optional roots:

- Claude Code: `~/.claude/projects` and `~/.config/claude-sol/projects`
- Codex: `$CODEX_HOME/sessions`, default `~/.codex/sessions`
- ChatGPT exports: `~/incoming/chatgpt-share-archive`

Set `MOONCITE_AUTO_SOURCES=0` before starting a process to disable every automatic optional root.

Manage additional local roots with:

```bash
mooncite source list
mooncite source add <origin> <absolute-root>
mooncite source remove <origin> <absolute-root>
mooncite rebuild
```

Configured origins are `claude-code`, `codex`, and `chatgpt`. Pi and OMP always use their client roots. Configured roots are additive. An exact configured origin and root suppresses only its matching automatic entry. Removing the configured root may reactivate that entry.

`source add` accepts an existing absolute normalized directory with no symlink component. It records authorization in `$XDG_CONFIG_HOME/mooncite/sources.json`. It never copies history.

For ChatGPT, request the official export under **Settings → Data controls → Export**. Extract it into the automatic archive directory or a configured root, then run `mooncite rebuild`. Mooncite reads `conversation.json`, `conversations.json`, and numbered `conversations-N.json` files.

Mooncite has no remote transport. Copy or mount remote history into an owner-controlled local root before registering it.

## Routine commands

```bash
mooncite status
mooncite rebuild
mooncite source list
```

`status` refreshes authorized sources and reports health, coverage, counts, client registrations, and errors grouped by safe source origin and failure reason. It omits transcript text, internal errors, and full source paths. A degraded index may remain searchable, but an empty recall is then inconclusive.

For `source_configuration_failure` or `source_root_unavailable`, restore the authorized configuration or root before rebuilding. For `source_discovery_failure`, restore directory access. For metadata, source-change, or read-and-parse failures, preserve the source history and run `mooncite rebuild` after correcting the source access problem.

For `source_limit_exceeded`, reduce the authorized source set or wait for a release with a higher supported limit. `mooncite rebuild` alone cannot fix the limit and will repeat the refusal. A rebuild performs a full verified reread only after the source set fits the supported bounds.

Recall and inspection are MCP tools, not shell commands. See the [agent workflow](../skills/mooncite/SKILL.md) and [protocol](protocol.md).

## Optional learned memory

Learned memory is off by default. Manage the owner-private opt-in with:

```bash
mooncite memory enable
mooncite memory status
mooncite memory disable
```

Restart or reload every client after enable or disable. The first enabled use creates `$XDG_STATE_HOME/mooncite/learned-memory.sqlite`. Disabling learned memory hides its tools but keeps that database.

Learned memory stores explicit agent-authored interpretations separately from source evidence. It performs no background extraction, model call, embedding, activation, reinforcement, or decay. See the [protocol](protocol.md) for provenance and mutation rules.

`unsupported_schema` means that the learned-memory database does not match the schema supported by the running Mooncite process. An older client can report this error after a newer version migrates the database. Install or restore a Mooncite version that supports the existing database, fully restart every client, and run `mooncite memory status` again. Keep `learned-memory.sqlite` intact. Mooncite does not downgrade an unknown schema, and purge removes learned data rather than repairing it.

## Disable, uninstall, and purge

| Command | Removes | Keeps |
| --- | --- | --- |
| `mooncite disable` | Owned client registrations | Package, launcher, derived state, configuration, source history |
| `mooncite uninstall` | Owned registrations, recognized package, exact launcher | Derived state, configuration, source history |
| `mooncite purge --yes` | Recognized evidence and learned-memory SQLite state | Package, launcher, configuration, source history |

All three operations fail closed when ownership or safe deletion cannot be verified. Purge refuses unknown entries, directories, links, unsafe ownership, overlapping source/state roots, and a running engine. Uninstall leaves the package in place when it cannot verify removal of an owned registration.

To remove registrations, state, launcher, and package while keeping source configuration and history:

1. Run `mooncite disable`.
2. Exit or reload every affected client.
3. Run `mooncite purge --yes`.
4. Run `mooncite uninstall`.

Mooncite has no updater or in-place version replacement. Use the installed version's launcher to uninstall it. Then install the new tagged version and restart each configured client.

## Quick fixes

- If the shell reports `mooncite: command not found`, use `"$HOME/.local/bin/mooncite"` or add `~/.local/bin` to `PATH`.
- If a client shows old tools after install, fully restart or reload it.
- If recall returns `inconclusive` or `unavailable`, follow its `next` action. Run `mooncite status` if needed.
- If Mooncite reports a registration or ownership conflict, resolve it and rerun the command. Mooncite will not overwrite it.
