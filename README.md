# Mooncite

Mooncite gives local coding agents bounded, citation-backed recall from authorized Pi, OMP, Claude Code, Codex, and ChatGPT conversation history. Recall returns deterministic evidence locators; a `verified` inspection compares them with current physical source bytes before returning a source window. Mooncite retrieves prior context—it does not decide what that context means or whether it remains authoritative.

## Install

Requires Linux with procfs, Node.js 24 or newer, and the `npm`/`npx` commands. Fetching the tagged package also requires access to GitHub. Mooncite fails closed when it cannot pin authorized source roots through Linux file descriptors.

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.4 install
"$HOME/.local/bin/mooncite" status
```

Tagged v4.0.4 is the current stable release and is not published on the npm registry. The untagged `main` branch is 4.0.5 prerelease development, identified by commit SHA rather than a stable install tag.

A fresh install places a stable package under `$XDG_DATA_HOME/mooncite` (default `~/.local/share/mooncite`), builds the evidence index under `$XDG_STATE_HOME/mooncite` (default `~/.local/state/mooncite`), and creates an exact launcher link at `~/.local/bin/mooncite`. It configures each supported client it can verify:

- Pi: packaged thin extension
- Oh My Pi (OMP): linked package with a packaged `.mcp.json`
- Codex: local stdio MCP registration
- Claude Code: local stdio MCP registration

The install result reports each registration. Use a client only when its value is `exact`; unavailable clients are reported and left untouched. A conflicting `mooncite` registration, unrelated launcher command, or different package at the stable install path is refused rather than overwritten.

After every install or reinstall, fully restart or reload each configured client before using Mooncite. An already-running client or MCP child process is not guaranteed to hot-reload and may continue serving old code or state.

If your shell reports `mooncite: command not found`, the installer has not edited your shell startup files. Use the exact path shown above, or add the launcher directory to `PATH`:

```bash
export PATH="$HOME/.local/bin:$PATH"
mooncite status
```

Pi and OMP use their standard session roots. Optional automatic roots are `~/.claude/projects`, `~/.config/claude-sol/projects`, `~/.codex/sessions` (or `$CODEX_HOME/sessions`), and `~/incoming/chatgpt-share-archive`. An explicit `source add` root overrides automatic discovery for that origin. Start a process with `MOONCITE_AUTO_SOURCES=0` to disable all automatic optional roots. ChatGPT is a source origin, not a fifth client registration.

## First recall

Recall is an MCP tool used inside a registered client, not a `mooncite recall` shell command. After restarting a client whose registration is `exact`, paste this prompt:

> Call `mooncite_status`. If Mooncite is ready, ask me for one distinctive phrase from an earlier conversation, pass that exact phrase to `mooncite_recall`, and pass the best candidate's `evidence_id` to `mooncite_inspect`. Rely on the source window only when the inspection outcome is `verified`; otherwise report the outcome. If recall returns no candidate, report that instead.

## Tools

Mooncite exposes exactly three MCP tools:

- `mooncite_recall` — bounded lexical search over authorized local session history
- `mooncite_inspect` — verify an evidence ID or URI and return a bounded physical source window
- `mooncite_status` — report source counts by origin, index freshness, coverage, and registration health without transcript text

Use recall first, then inspect the returned `mooncite:<origin>:…` or `mooncite://<origin>/…` locator before relying on the evidence. Only a `verified` outcome contains a current-source-verified window. Origins are `pi`, `omp`, `claude-code`, `codex`, and `chatgpt`.

## Common operations

```bash
mooncite status
mooncite rebuild
mooncite source list
```

`source add` records an explicit local override without copying history; `source remove` removes only that override, so an available automatic root may become active again.

`disable` removes only client registrations recorded as owned by the installation. `uninstall` also removes the recognized stable package and exact launcher link. Both preserve source history, source authorizations, and the evidence index. Fully restart or reload affected clients after either command so previously loaded tools stop running.

`purge --yes` separately deletes only recognized Mooncite-owned derived state and refuses unknown entries. Run it before uninstall if you also want to remove the evidence index. Mooncite has no in-place cross-version updater. See [operations](docs/operations.md) for source commands, conservative removal order, failure handling, and version changes.

## ChatGPT desktop conversations

The ChatGPT desktop apps use the same account-backed conversation service as ChatGPT on the web; Mooncite does not scrape app caches, browser cookies, or credentials. Request the supported data export in ChatGPT under **Settings → Data controls → Export**, extract it into `~/incoming/chatgpt-share-archive` (or register the extracted directory with `source add chatgpt`), then run `mooncite rebuild`. Mooncite scans `conversation.json`, `conversations.json`, and numbered `conversations-N.json` files; each may contain one conversation object or a top-level array.

## Privacy boundary

Mooncite is local and read-only with respect to every source file. Automatic discovery is limited to the named standard roots and can be disabled for a process with `MOONCITE_AUTO_SOURCES=0`. Recall returns bounded excerpts; only a `verified` inspection contains a current-source-verified window. Text sent through an MCP tool becomes model context and is then subject to that model provider's data handling. Mooncite does not upload history, request ChatGPT exports, or invoke SSH; remote history must first be copied or mounted into a local root.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [operations](docs/operations.md), and [security](docs/security.md).

Repository: <https://github.com/WhenMoon-afk/claude-memory-mcp>
