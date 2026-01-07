# Changelog

All notable changes to this project are documented here.  

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).  

---

## 2.x – TypeScript + SQLite implementation (`@whenmoon-afk/memory-mcp`)

This series is a complete rewrite of the original Python server. It is implemented in TypeScript, runs on Node.js, uses SQLite for storage, and is distributed as the npm package `@whenmoon-afk/memory-mcp`.

Upgrading from **1.x → 2.x** is a major, breaking change: storage format, deployment model, and configuration differ from the Python implementation.

### [2.4.2] – 2025‑01‑07

#### Fixed
- Fixed npm bin path format to use "./" prefix for proper CLI installation.

---

### [2.4.1] – 2025‑01‑07

#### Added
- **Memory consolidation tool**: New `memory-mcp-consolidate` CLI for merging multiple memory databases into one.
  - `--discover` mode: Automatically finds memory databases in common locations.
  - Content-based deduplication: Uses SHA-256 hash of content + type to detect duplicates.
  - Keeps most recently accessed version when duplicates found, merges access counts.
  - Checkpoints WAL files before reading to ensure data integrity.
  - Source databases are NOT modified.
  - Run via: `npx @whenmoon-afk/memory-mcp-consolidate --discover` or `npx @whenmoon-afk/memory-mcp-consolidate <target.db> <source1.db> [source2.db] ...`

---

### [2.4.0] – 2025‑01‑07

#### Changed
- **Distribution overhaul**: Primary installation method is now `npx github:whenmoon-afk/claude-memory-mcp`, which fetches directly from GitHub and bypasses npm cache issues that caused users to run stale versions.
- **Bin entry fix**: The default `memory-mcp` bin now points to the server (`dist/index.js`), not the installer. The installer is available separately as `memory-mcp-install`.
- **Dynamic version logging**: Server now reads version from `package.json` at runtime instead of hardcoding, fixing the "Memory MCP v2.0" log message bug.
- **Unified database path**: All platforms now use `~/.memory-mcp/memory.db` for simplicity. Windows paths use forward slashes for config consistency.
- **Installer updated**: `npx @whenmoon-afk/memory-mcp-install` now generates the `npx github:` config instead of node path config.

#### Fixed
- Fixed Windows compatibility by documenting working config patterns (plain `npx` works, no `cmd /c` wrapper needed for most setups).
- Fixed Node.js version mismatch errors when running from different environments (devcontainer vs WSL vs native).
- All log messages now use consistent `[memory-mcp v${VERSION}]` format.

#### Documentation
- README rewritten with platform-specific installation instructions (macOS, Linux, Windows, WSL).
- Added troubleshooting section for common issues (stale cache, Windows connection errors, slow startup).
- Multiple installation methods documented: GitHub (always-latest), global npm install (offline/reliable), and automatic installer.

---

### [2.3.0] – 2025‑12‑09

#### Changed
- Clarified that the primary supported target is **Claude Desktop**, and aligned documentation around that usage rather than multiple untested clients.  
- Streamlined the README so it focuses on installation, configuration, and typical usage, reducing older deployment guidance that no longer reflects the current implementation.  
- Adjusted the npm `bin` setup so that invoking `npx @whenmoon-afk/memory-mcp` runs the installer script responsible for configuring Claude Desktop, not the MCP server entrypoint.  

#### Removed
- Removed Docker‑related artifacts for this TypeScript + SQLite implementation (image definitions and compose files), which were not maintained or tested against the current SQLite schema and runtime.  
- Dropped specific Claude Code installation instructions from the README, pointing users instead toward Claude Code’s native memory or other dedicated plugins.  

#### Fixed
- Updated MCP tool implementations (`memory-store`, `memory-recall`, `memory-forget`) to use synchronous database calls consistent with `better-sqlite3`, eliminating unnecessary `async/await` signatures and associated lint warnings.  
- Resolved ESLint issues related to `require-await` and template usage so that the lint job passes cleanly in CI.  
- Ensured the package’s command‑line entry points to the installer script and that `npx @whenmoon-afk/memory-mcp` reliably runs the Claude Desktop configuration flow.  

---

### [2.2.2] – 2025‑12‑09

#### Fixed
- Unified the logic that chooses the default SQLite database location so that all entry paths (Claude Desktop, command‑line invocation, or other clients) now resolve to the same **OS‑specific default** when `MEMORY_DB_PATH` is not set.  
- Preserved support for custom `MEMORY_DB_PATH` values while removing the earlier behavior where some usages silently wrote `./memory.db` into the working directory.  

#### Technical details
- Added a helper in the main server module to compute and return a platform‑appropriate default database path (different for macOS, Windows, and Linux) and to create the containing directory on first use if needed.  

---

### [2.2.1] – 2025‑12‑08

#### Fixed
- Corrected the npm `bin` mapping that is used to start the server directly so that it now launches the compiled MCP server (`dist/index.js`) instead of the installer script.  
- Restored the ability to use this package as a direct CLI entrypoint in environments where the auto‑configuration installer is not required.  

---

### [2.2.0] – 2025‑12‑07

#### Added
- Introduced a **pluggable database driver abstraction** (`DbDriver`) and a driver factory, allowing the server to select between `better-sqlite3` and a stub `sqljs` driver via the `MEMORY_DB_DRIVER` environment variable.  
- Enhanced the installer with **platform‑specific database locations**, so Claude Desktop is configured with a standard database path appropriate to each supported OS, instead of ad‑hoc defaults.  
- Documented a **Docker‑based deployment** path for the TypeScript + SQLite implementation, including a multi‑stage Dockerfile and a `docker-compose.yml` that set up persistent storage volumes.  
- Added written guidance for using the server with **Claude Code** via the terminal, including examples of global (`--scope user`) and per‑project (`--scope local`) memory scopes.  

#### Changed
- Improved the installer to:
  - Print out the resolved config and database paths, so users can see exactly which files it will touch.  
  - Create the database directory automatically if it does not already exist.  
  - Set `MEMORY_DB_PATH` in the generated Claude Desktop MCP configuration, ensuring the server and installer agree on database location.  

#### Technical details
- The new driver abstraction encapsulates all low‑level SQLite operations, allowing additional compatible backends to be added later without changing higher‑level memory logic.  
- Existing users storing data in a local `./memory.db` file remain supported; when present, that configuration still works, and `MEMORY_DB_PATH` continues to override defaults.  

---

### [2.1.2] – 2025‑11‑04

#### Fixed
- Addressed a critical **path‑resolution bug** in the installer that previously constructed an incorrect path to the built server file and led to “Cannot find module” errors when Claude Desktop tried to start the MCP server.  
- Simplified server path handling to rely directly on the package’s root directory (`__dirname`) instead of traversing up a directory, which had omitted the `memory-mcp` segment from the computed path.  

#### Technical details
- Updated `install.js` to compute the path to `dist/index.js` relative to the actual package root.  
- Bumped the package version and updated any references in the source and tests to maintain consistency.  

---

### [2.1.1] – 2025‑11‑04

#### Fixed
- Fixed a configuration bug where the installer wrote a Claude Desktop MCP entry that invoked `npx @whenmoon-afk/memory-mcp` again, causing the installer’s human‑oriented output to appear on the MCP JSON‑RPC channel rather than starting the server.  
- Modified the installer to configure Claude Desktop to run `node` with the absolute path to `dist/index.js`, ensuring that installed configurations directly start the MCP server binary.  

#### Technical details
- Adjusted `install.js` to generate a stable, absolute command and argument list for the MCP server entry (`command: "node", args: ["/path/to/dist/index.js"]`).  
- Updated version metadata in source files to reflect the hotfix.  

---

### [2.1.0] – 2025‑11‑04

#### Added
- Added an **automatic installer** script (`install.js`) that:
  - Detects the host operating system (macOS, Windows, Linux).  
  - Discovers or creates the Claude Desktop configuration directory.  
  - Creates a backup of the existing configuration.  
  - Injects or updates an MCP server entry pointing to the memory server.  
- Introduced **integration tests** that validate installer behavior and basic package integrity, including ensuring required artifacts are present in the published tarball.  
- Set up a **GitHub Actions CI workflow** that runs linting, type checks, builds, tests, security audits, and packaging verification across multiple operating systems and Node versions.  

#### Changed
- Updated the npm `bin` field to point at `install.js`, so that running `npx @whenmoon-afk/memory-mcp` performs a one‑time installation/configuration step rather than starting the server directly.  
- Revised the README to more accurately describe runtime dependencies and added explicit platform‑specific installation examples.  

#### Security
- Documented development‑time vulnerability findings from `npm audit` affecting only dev‑dependencies and not the published runtime bundle, explaining why no immediate breaking upgrades were applied.  

---

### [2.0.0] – 2025‑11‑03

#### Added
- First stable npm release of the **TypeScript + SQLite** implementation:
  - Implemented MCP tools to **store**, **recall**, and **forget** memories.  
  - Introduced a SQLite schema with tables for `memories`, `entities`, `memory_entities`, and `provenance`, plus an FTS5 virtual table for full‑text search.  
  - Added importance scoring, soft deletes, and provenance tracking for auditing how memories evolve over time.  
  - Implemented a dual‑response recall pattern that respects token budgets by providing concise summaries alongside detailed memory entries.  

#### Changed
- Published the implementation under the scoped npm name `@whenmoon-afk/memory-mcp`, making it distinct from the earlier Python codebase and suitable for installation via `npm` / `npx`.  

---

## 1.x – Python / JSON implementation (`memory_mcp`) – Legacy

This series covers the original Python implementation that stores memories in a JSON file, uses sentence‑transformer embeddings, and organizes logic into domain modules. It is no longer the primary implementation but remains part of the project’s history.  

Upgrading from 1.x to 2.x requires migrating to the new TypeScript + SQLite server; data and configuration are not automatically compatible.  

### [1.0.0] – 2025‑04‑29

#### Added
- Initial release of the **Python‑based Claude Memory MCP server**:
  - Implemented as a Python package `memory_mcp` with modules for episodic, semantic, temporal, and persistence domains, orchestrated by a `MemoryDomainManager`.  
  - Stored memories in a configurable JSON file with tiered structures (short‑term, long‑term, archived) and metadata such as timestamps, importance scores, and embeddings.  
  - Used `sentence-transformers` and NumPy to generate and compare embeddings for semantic search.  
  - Exposed MCP tools for storing, retrieving, listing, updating, deleting, and inspecting memories via a Python MCP server implementation.  

- Added an **auto‑memory module**:
  - Heuristics (`should_store_memory`, `extract_memory_content`) that analyze user messages for preferences, traits, and factual information and decide when and how to create memories.  
  - System‑prompt templates intended to be used by MCP clients (such as Claude Desktop) so that the model can proactively decide when to call memory tools, within the constraints of MCP’s tool‑call model.  

- Provided deployment and example assets:
  - Dockerfile and `docker-compose.yml` for running the Python server in a container with persistent volumes.  
  - Example scripts demonstrating how to invoke the MCP server over stdio to store and retrieve memories from the command line.  

#### Status
- The 1.x Python / JSON implementation is **superseded** by the 2.x TypeScript + SQLite implementation and is not the focus of ongoing development, but it remains an important historical reference for the project’s design and goals.
