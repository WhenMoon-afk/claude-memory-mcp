# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.3.0] - 2025-12-09

### Changed
- **Scope clarification**: Memory MCP is now focused on Claude Desktop
- Simplified README to essential installation and usage information
- Bin entry restored to install.js for Claude Desktop auto-configuration

### Removed
- Docker support (Dockerfile, docker-compose.yml, .dockerignore) - was untested
- Claude Code installation documentation - use native Claude Code memory or episodic-memory plugin instead

### Fixed
- Removed async/await from tool functions (memoryStore, memoryRecall, memoryForget) - all database operations are synchronous with better-sqlite3
- Fixed ESLint require-await and template literal errors
- Bin entry now correctly points to install.js (installer) instead of dist/index.js (server)
- Running "npx @whenmoon-afk/memory-mcp" now properly runs the Claude Desktop installer

---

## [2.2.2] - 2025-12-09

### Fixed

- **Platform-aware database defaults** - Server now uses OS-appropriate database location regardless of how it's started
  - Previously Claude Code users got `./memory.db` in project directory (wrong)
  - Now all clients use consistent location by default
  - `MEMORY_DB_PATH` environment variable still works for custom locations

| Platform | Default Database Location |
|----------|---------------------------|
| macOS | `~/.claude-memories/memory.db` |
| Windows | `%APPDATA%/claude-memories/memory.db` |
| Linux | `~/.local/share/claude-memories/memory.db` |

### Technical Details

- Added `getDefaultDbPath()` function to `src/index.ts`
- Directory auto-created on first run if it doesn't exist
- Backward compatible with existing `MEMORY_DB_PATH` configurations

---

## [2.2.1] - 2025-12-08

### Fixed

- **bin entry now starts MCP server correctly** - Previously, `npx @whenmoon-afk/memory-mcp` ran the Claude Desktop installer script instead of the MCP server, causing Claude Code integration to fail. The bin entry now correctly points to `dist/index.js`.

---

## [2.2.0] - 2025-12-07

### Added
- **Pluggable database driver abstraction** - Support for different SQLite implementations
  - `MEMORY_DB_DRIVER` environment variable to select driver
  - Default: `better-sqlite3` (production)
  - Stub: `sqljs` (future WebAssembly support)
- **Platform-specific database location** - Installer now configures OS-appropriate paths
  - macOS: `~/.claude-memories/memory.db`
  - Windows: `%APPDATA%/claude-memories/memory.db`
  - Linux: `~/.local/share/claude-memories/memory.db`
- **Docker deployment support** - Containerized deployment option
  - Multi-stage Dockerfile for optimized builds
  - docker-compose.yml with persistent volume configuration
- **Claude Code installation documentation** - Guide for terminal-based Claude users
  - Global memory with `--scope user`
  - Per-project memory with `--scope local`

### Changed
- Installer creates database directory automatically
- Installer displays all configuration paths during setup
- Installer passes `MEMORY_DB_PATH` via MCP config environment

### Technical Details
- Database abstraction uses DbDriver interface for future extensibility
- Backward compatible: existing `./memory.db` setups continue working
- Environment variable override always takes precedence

---

## [2.1.2] - 2025-11-04

### Fixed

- **CRITICAL: Path resolution bug in installer** - Fixed incorrect path calculation that caused "Cannot find module" errors
  - **Root cause**: Used `dirname(__dirname)` which went up one directory level too many
  - **Symptoms**: Server path was `.../node_modules/@whenmoon-afk/dist/index.js` (missing `memory-mcp`)
  - **Correct path**: `.../node_modules/@whenmoon-afk/memory-mcp/dist/index.js`
  - **Fix**: Changed to use `__dirname` directly since it's already the package root
  - **Impact**: v2.1.1 was non-functional; v2.1.2 fixes the path resolution

### Technical Details

**Modified Files:**
- `install.js:38-48` - Changed `dirname(__dirname)` to `__dirname` for correct path resolution
- `package.json` - Version bumped to 2.1.2
- `src/index.ts` - Version string updated to 2.1.2
- `test/integration.test.js` - Updated version expectation

**Path resolution:**
- Before: `join(dirname(__dirname), 'dist', 'index.js')` → Missing `memory-mcp` folder
- After: `join(__dirname, 'dist', 'index.js')` → Correct full path

---

## [2.1.1] - 2025-11-04

### Fixed

- **CRITICAL: Server startup failure** - Fixed installer configuration bug that caused server to crash immediately after installation
  - **Root cause**: Installer was configuring Claude Desktop to run `npx @whenmoon-afk/memory-mcp`, which executed `install.js` again instead of the actual server
  - **Symptoms**: JSON parsing errors when Claude tried to connect (installer output sent instead of MCP JSON-RPC protocol)
  - **Fix**: Installer now configures Claude Desktop with direct path to `dist/index.js` using `node` command
  - **Impact**: v2.1.0 was completely non-functional; v2.1.1 is a critical hotfix
- Removed platform-specific Windows notes from installer (now using unified approach for all platforms)

### Technical Details

**Modified Files:**
- `install.js` - Changed `getMcpServerConfig()` to use `node` + absolute path to `dist/index.js` instead of `npx` command
- `package.json` - Version bumped to 2.1.1
- `src/index.ts` - Version string updated to 2.1.1

**How it works now:**
1. User runs `npx @whenmoon-afk/memory-mcp` → Executes `install.js` (one-time setup)
2. Installer configures Claude Desktop with: `node /path/to/package/dist/index.js`
3. Claude Desktop starts server → Runs actual MCP server, not installer
4. MCP JSON-RPC protocol works correctly

---

## [2.1.0] - 2025-11-04

### Added

- **Automatic Claude Desktop configuration installer** - Run `npx @whenmoon-afk/memory-mcp` to automatically configure Claude Desktop
  - Platform-aware detection (macOS/Windows/Linux)
  - Automatic config path detection
  - Backup creation before modification
  - Idempotent updates (safe to run multiple times)
- **Windows support with cmd /c wrapper** - Installer automatically configures Windows-specific npx wrapper
- **Platform-specific configuration examples** in README
  - macOS/Linux: Direct npx command
  - Windows: `cmd /c` wrapper pattern
- **Integration tests** for installer functionality and package integrity
- **CI/CD workflow** with GitHub Actions
  - Lint, typecheck, build, and test jobs
  - Multi-platform testing (Ubuntu, Windows, macOS)
  - Multi-version Node.js testing (18, 20, 22)
  - Security audit
  - Package integrity verification
- **Dependencies section** in README documenting runtime dependencies
- **prepare script** in package.json for automatic builds during npm install

### Fixed

- **README accuracy** - Removed incorrect "no external dependencies" claim
  - Now accurately states "minimal runtime dependencies"
  - Added Dependencies section listing @modelcontextprotocol/sdk and better-sqlite3
  - Explained rationale for each dependency
- **Windows installation documentation** - Added clear cmd /c wrapper examples and explanation

### Changed

- **bin entry** in package.json now points to `install.js` (automatic setup) instead of `dist/index.js`
- **Installation workflow** - Default `npx` command now runs installer, not server directly
- **Version bumped** to 2.1.0 (minor version for backward-compatible new features)

### Security

- **npm audit findings**: 5 moderate severity vulnerabilities in dev dependencies only (esbuild, vite, vitest)
  - These affect development/testing tools only, **not runtime or published package**
  - Vulnerabilities: esbuild development server (GHSA-67mh-4wv8-2f99)
  - Fix available with `npm audit fix --force` but requires breaking vitest upgrade (0.x → 4.x)
  - **No action required** - vulnerabilities do not affect production usage or published package

### Technical Details

**New Files:**
- `install.js` - Automatic installer script with platform detection
- `test/integration.test.js` - Integration tests
- `.github/workflows/ci.yml` - CI/CD pipeline
- `CHANGELOG.md` - This file

**Modified Files:**
- `package.json` - Version, bin entry, files array, prepare script
- `src/index.ts` - Version string updated to 2.1.0
- `README.md` - Installation instructions, Windows examples, Dependencies section

**Rollback Instructions:**
If issues arise with 2.1.0:
1. Users can restore config backup: `cp claude_desktop_config.json.backup claude_desktop_config.json`
2. Developers can revert to 2.0.0: `npm install @whenmoon-afk/memory-mcp@2.0.0`
3. Manual config still supported (see README "Manual Configuration" sections)

---

## [2.0.0] - 2025-11-03

### Added
- Initial npm package release
- Memory storage, recall, and forget tools
- Dual-response pattern with token budgeting
- FTS5 full-text search
- Entity extraction and importance scoring
- Provenance tracking
- Soft deletes

### Changed
- Package name to `@whenmoon-afk/memory-mcp`

---

## [1.0.0] - 2025-11-03

### Added
- Initial release
- Basic memory server functionality
