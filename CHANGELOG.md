# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [4.2.0] - 2026-02-25

### Changed

- **MCP server renamed from "memory" to "identity"** — avoids collision with native Claude memory feature. Tools now appear as `identity:reflect`, `identity:anchor`, `identity:self`
- **Scoring formula**: `sqrt(recalls) * log2(days + 1) * diversity_bonus * recency` — more observations increase score, diversity gives a bonus instead of a penalty
- **session_summary**: `reflect` now appends dated entries to self-state (keeps last 5) instead of replacing
- **self output**: Shows top 10 patterns by score with "...and N more" note, instead of dumping all

### Fixed

- **Windows data directory**: Added `APPDATA` support — resolves to `%APPDATA%\claude-memory` on Windows instead of creating non-idiomatic `.local/share/` path
- **Anchor double-dash**: Appending content starting with `- ` no longer produces `- - content`
- **auto_promote feedback**: When `auto_promote: true` but nothing crosses threshold, explains why instead of staying silent
- **Identity prompt anchors**: Template detection checks for actual entries (`- ` lines) instead of matching header text
- **Identity prompt self-state**: Checks for dated entries (`## YYYY-MM-DD` headers) instead of fragile string matching

### Added

- Startup verification: server logs `identity v4.2.0 ready` to stderr on successful start
- Tool descriptions include "when to use" guidance for models
- `appendSelfStateEntry()` on IdentityManager — dated entries with rotation
- `pruneStale()` on ObservationStore — auto-removes single-recall concepts older than 30 days
- Improved `reflect` output — new vs updated counts, per-concept scores, promotion status
- 105 tests across 12 files (up from 71)

---

## [4.1.1] - 2026-02-22

### Fixed

- **Critical**: `npx memory-mcp setup` and `npx memory-mcp reflect` silently did nothing when installed via npm — the `isMainModule` check didn't match the `memory-mcp` bin symlink
- CLI `reflect` now validates `concepts` field before calling handler (found via E2E install testing)

---

## [4.1.0] - 2026-02-22

### Added

- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`) on all three tools
- Error wrapping in all tool handlers — file system errors return `isError: true` instead of crashing the server
- 2 new tests for error handling (70 total)

---

## [4.0.0] - 2026-02-22

### BREAKING

- **Complete rewrite** — v3 generic memory system (SQLite, FTS5, entity extraction) replaced with identity persistence architecture.
- **All v3 tools removed** — `memory_store`, `memory_recall`, `memory_forget` no longer exist.
- **Database removed** — No SQLite, no better-sqlite3 dependency. Uses JSON file + markdown files.

### Added

- `reflect` tool — End-of-session concept extraction with promotion scoring
- `anchor` tool — Explicit identity file writing (soul, self-state, anchors)
- `self` tool — Query current identity state with observed patterns
- Three managed identity files: `soul.md`, `self-state.md`, `identity-anchors.md`
- JSON observation store tracking concept frequency, distinct days, and contexts
- Promotion formula with concept scoring and threshold-based promotion
- Auto-detection of new days for distinct_days tracking
- `auto_promote` option on reflect — automatically promotes concepts above threshold to identity-anchors.md
- `identity` MCP prompt — loads persistent identity context automatically at session start
- CLI subcommands: `setup` (install instructions), `reflect` (for hooks/scripts)
- Auto-reflect stop hook documentation for Claude Code
- XDG-compliant data directory resolution
- CI coverage threshold enforcement (100% functions, 85% lines)
- 68 tests across 11 files (unit + integration)

### Removed

- SQLite database and all related code
- better-sqlite3 dependency
- FTS5 search
- Entity extraction, fact extraction, summary generation
- Token budgeting, importance scoring, TTL management
- Response formatter, semantic search
- Desktop extension packaging
- ESLint, Prettier, commitlint configs
- Plugin manifest and v3 skill files

---

## [3.0.0] - 2026-02-01

### BREAKING

- Removed cloud sync functionality. Server is now fully local-only.

### Removed

- Cloud sync integration and related code

---

_For v2.x and earlier history, see git log._
