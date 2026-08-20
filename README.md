# Mooncite

Mooncite gives local coding agents bounded, citation-backed recall from authorized Pi, OMP, Claude Code, Codex, and ChatGPT conversation history. Recall returns deterministic evidence locators; a `verified` inspection compares them with current physical source bytes before returning a source window. Mooncite retrieves prior context—it does not decide what that context means or whether it remains authoritative.

## Install

Requires Linux with procfs, Node.js 24 or newer, and the `npm` command. Fetching the tagged package also requires access to GitHub. Mooncite fails closed when it cannot pin authorized source roots through Linux file descriptors.

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.5 install
```

Optionally verify the installed launcher separately:

```bash
"$HOME/.local/bin/mooncite" status
```

Tagged v4.0.5 is the current stable release and is distributed from GitHub rather than the npm registry.

To try the current prerelease without replacing the stable tag:

```bash
npx --yes github:WhenMoon-afk/claude-memory-mcp#v4.0.6-preview.1001.0 install
```

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

> Call `mooncite_recall` with one distinctive phrase from an earlier conversation. Read its `outcome`, `conclusive`, `meaning`, candidate `match`, warnings, and `next`. If it returns a candidate, pass the best candidate's `evidence_id` to `mooncite_inspect`. Treat `verified` as physical provenance, not truth or current authority. If recall is `inconclusive` or `unavailable`, follow its next action instead of claiming the evidence is absent.

## Tools

By default Mooncite exposes exactly three evidence MCP tools:

- `mooncite_recall` — bounded lexical search with explicit `matches`, `weak_leads`, `no_match`, `inconclusive`, `invalid_scope`, and `unavailable` outcomes
- `mooncite_inspect` — verify an evidence ID or URI against current physical bytes and return a bounded source window
- `mooncite_status` — report ready, degraded, or unavailable health, source counts by origin, refresh time, grouped errors, and registration state without transcript text

Recall explains exact/phrase/term matching, matched and missing terms, excerpt truncation, duplicate collapse, recursive-output suppression, and a concrete next action. Start unscoped. Narrow only with the exact `project` or source-qualified `sessionId` copied from a candidate. Recall searches the current projection first and performs one bounded incremental refresh only on a miss; `mooncite rebuild` remains an explicit full operation.

Use recall first, then inspect the returned `mooncite:<origin>:…` or `mooncite://<origin>/…` locator before relying on the evidence. A `verified` inspection means the cited physical bytes and identity match the active index; it does not establish that the quoted claim is correct or still authoritative. Origins are `pi`, `omp`, `claude-code`, `codex`, and `chatgpt`.

This prerelease also has a separate, default-off learned-memory mode. `mooncite memory enable` writes a strict owner-private opt-in; after every client is restarted, it conditionally adds `mooncite_memory_recall`, `mooncite_memory_inspect`, `mooncite_memory_write`, and `mooncite_memory_delete`. These tools store explicit citation-backed **derived interpretations** in `$XDG_STATE_HOME/mooncite/learned-memory.sqlite`. They never add learned text to source evidence or to the disposable evidence index. Use `mooncite memory disable` to hide the tools while retaining learned state, and `mooncite memory status` to inspect readiness.

## Common operations

```bash
mooncite status
mooncite rebuild
mooncite source list
```

`source add` records an explicit local override without copying history; `source remove` removes only that override, so an available automatic root may become active again.

`disable` removes only client registrations recorded as owned by the installation. `uninstall` also removes the recognized stable package and exact launcher link. Both preserve source history, source authorizations, the evidence index, learned-memory configuration, and any learned database. Fully restart or reload affected clients after either command so previously loaded tools stop running.

`purge --yes` separately deletes only recognized Mooncite-owned derived state, including the evidence and learned-memory SQLite files, and refuses unknown entries. It leaves source history and both configuration files intact. Mooncite has no in-place cross-version updater. See [operations](docs/operations.md) for source commands, learned-memory retention, conservative removal order, failure handling, and version changes.

## ChatGPT desktop conversations

The ChatGPT desktop apps use the same account-backed conversation service as ChatGPT on the web; Mooncite does not scrape app caches, browser cookies, or credentials. Request the supported data export in ChatGPT under **Settings → Data controls → Export**, extract it into `~/incoming/chatgpt-share-archive` (or register the extracted directory with `source add chatgpt`), then run `mooncite rebuild`. Mooncite scans `conversation.json`, `conversations.json`, and numbered `conversations-N.json` files; each may contain one conversation object or a top-level array.

## Privacy boundary

Mooncite is local and read-only with respect to every source file. Automatic discovery is limited to the named standard roots and can be disabled for a process with `MOONCITE_AUTO_SOURCES=0`. Recall returns bounded excerpts; only a `verified` inspection contains a current-source-verified window. Text sent through an MCP tool becomes model context and is then subject to that model provider's data handling. Mooncite does not upload history, request ChatGPT exports, or invoke SSH; remote history must first be copied or mounted into a local root.

See [architecture](docs/architecture.md), [protocol](docs/protocol.md), [operations](docs/operations.md), and [security](docs/security.md).

Repository: <https://github.com/WhenMoon-afk/claude-memory-mcp>
