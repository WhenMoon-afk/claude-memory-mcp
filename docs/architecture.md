# Architecture

Mooncite has one deep core module, `MoonciteEngine`. Its interface is `recall`, `inspect`, `status`, `rebuild`, and `close`; source adapters, coherent reads, SQLite transactions, FTS ranking, incremental refresh, corruption recovery, and last-good retention stay behind that seam.

Mooncite 4.0.2 has five explicit source adapters: Pi session-format-v3 JSONL, compatible OMP JSONL, canonical Claude Code session JSONL, Codex rollout JSONL, and ChatGPT conversation JSON exports. OMP accepts its optional fixed-width title preamble. Claude Code excludes nested subagent and workflow copies. Codex indexes the user and assistant event stream rather than duplicate transport records. ChatGPT incrementally separates top-level export-array conversations, uses bounded conversation-object byte locations, and records current versus off-branch state.

`mooncite serve` wraps the engine in one stdio MCP server. OMP discovers its package-root-safe `.mcp.json`; Codex and Claude Code register the same server directly. The packaged Pi extension only translates native tool calls to MCP methods and contains no retrieval behavior.

Client registrations successfully configured by Mooncite are recorded in an owner-only installation journal. Disable and uninstall act only on those recorded clients; an unavailable unowned client does not block cleanup, while an unavailable owned client preserves the package for a safe retry.

SQLite is a derived projection. Full indexing publishes inside one immediate transaction with per-source savepoints. Incremental refresh admits coherent append-only Pi suffixes and new regular files. Authorized non-append OMP, Claude Code, Codex, and ChatGPT changes replace only that source projection transactionally. Removal or unsafe mutation cannot publish a partial replacement over a usable generation. A malformed or corrupt derived database is deleted and rebuilt; source files are never repaired or rewritten.

At runtime, configured source roots are recomputed on every refresh. Pi and OMP roots are fixed by their clients. Narrow automatic registrations cover the two standard Claude profiles, the standard Codex sessions directory, and the existing local ChatGPT archive directory. A configured root overrides automatic discovery for the same origin, and the process-level opt-out removes all automatic optional roots without restarting the engine.
