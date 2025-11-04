# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.2] - 2025-01-04

### Fixed
- **CRITICAL:** Path resolution bug in installer causing "Cannot find module" errors
- Changed `dirname(__dirname)` to `__dirname` in `install.js:38-48`
- v2.1.1 was non-functional; v2.1.2 fixes path resolution

---

## [2.1.1] - 2025-01-04

### Fixed
- **CRITICAL:** Server startup failure - installer was re-running on server start instead of launching MCP server
- Installer now configures Claude Desktop with direct `node` path to `dist/index.js`
- v2.1.0 was non-functional; v2.1.1 is a critical hotfix

---

## [2.1.0] - 2025-01-03

### Added
- Automatic installer with platform detection (macOS/Windows/Linux)
- Windows `cmd /c` wrapper support
- CI/CD workflow: lint, test, build, multi-platform (Ubuntu/Windows/macOS), multi-Node (18/20/22)
- Integration tests and package verification
- README improvements: platform-specific configs, dependencies section

### Changed
- `package.json` bin entry now points to `install.js` for auto-setup
- Default `npx` command runs installer, not server directly

### Security
- 5 moderate vulnerabilities in dev dependencies only (esbuild, vite, vitest) - no production impact

---

## [2.0.0] - 2025-01-02

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

## [1.0.0] - 2024-12-XX

### Added
- Initial release
- Basic memory server functionality
