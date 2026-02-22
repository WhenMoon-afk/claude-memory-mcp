# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
- Promotion formula: `score = total_recalls * log2(distinct_days + 1) * context_diversity * recency_weight`
- Auto-detection of new days for distinct_days tracking
- XDG-compliant data directory resolution
- 52 tests across 8 files (unit + integration)

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
