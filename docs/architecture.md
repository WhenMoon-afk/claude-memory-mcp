# Architecture

Mooncite has one deep core module, `MoonciteEngine`. Its interface is `recall`, `inspect`, `status`, `rebuild`, and `close`; Pi normalization, coherent reads, SQLite transactions, FTS ranking, incremental refresh, corruption recovery, and last-good retention stay behind that seam.

The only source adapter in 4.0.0 reads Pi session-format-v3 JSONL beneath the standard sessions directory. Core records retain a `sourceKind` and citations are source-qualified, leaving room for later explicit source adapters without a plugin framework.

`mooncite serve` wraps the engine in one stdio MCP server. OMP discovers its package-root-safe `.mcp.json`; Codex and Claude Code register the same server directly. The packaged Pi extension only translates native tool calls to MCP methods and contains no retrieval behavior.

SQLite is a derived projection. Full indexing publishes inside one immediate transaction with per-source savepoints. Incremental refresh admits only coherent append-only suffixes and new regular files. Removal or unsafe mutation cannot publish a partial replacement over a usable generation. A malformed or corrupt derived database is deleted and rebuilt; source files are never repaired or rewritten.
