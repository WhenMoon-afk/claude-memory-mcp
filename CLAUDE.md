# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server providing persistent memory for Claude Desktop and MCP-compatible AI assistants. Published to npm as `@whenmoon-afk/memory-mcp`. Part of the [Substratia](https://substratia.io) memory infrastructure ecosystem.

Three MCP tools: `memory_store` (create/update with auto-summarization and entity extraction), `memory_recall` (FTS5 search with token-aware progressive loading), `memory_forget` (soft-delete with provenance audit trail).

## Commands

```bash
npm install            # Install deps (compiles better-sqlite3 native bindings)
npm run build          # Compile TypeScript (tsc → dist/)
npm test               # Run vitest tests
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # Vitest with v8 coverage
npm run dev            # Watch mode with tsx
npm run lint           # ESLint (src/ only)
npm run lint:fix       # ESLint with auto-fix
npm run typecheck      # TypeScript type checking (tsc --noEmit)
npm run format         # Prettier formatting
npm run release        # Run tests + build (pre-publish check)
```

Run a single test file: `npx vitest run test/integration.test.js`
Run tests matching a pattern: `npx vitest run -t "pattern"`

## Architecture

### Data Flow

```
MCP Client → index.ts (tool routing + Zod validation) → tools/*.ts → database + extractors + scoring
```

1. **Entry point** (`src/index.ts`): Registers MCP tools via `@modelcontextprotocol/sdk`, validates input with Zod schemas from `src/validation/schemas.ts`, routes to tool implementations
2. **Tool implementations** (`src/tools/`): `memory-store.ts` handles both create and update (determined by presence of `input.id`), `memory-recall.ts` implements dual-response pattern (index summaries + token-budget-limited details), `memory-forget.ts` does soft deletes
3. **Search** (`src/search/semantic-search.ts`): FTS5 full-text search with hybrid scoring (40% importance, 30% recency, 20% frequency, 10% base)
4. **Response formatting** (`src/tools/response-formatter.ts`): Three detail levels — minimal (~30 tokens), standard (~200 tokens), full (~500 tokens). Token estimation uses ~4 chars/token heuristic

### Database Layer

- **Driver abstraction** (`src/database/db-driver.ts`): `DbDriver` interface decouples from better-sqlite3. Factory in `driver-factory.ts` selects driver via `MEMORY_DB_DRIVER` env var (default: `better-sqlite3`, stub: `sqljs`)
- **Connection** (`src/database/connection.ts`): Singleton pattern, provides `getDatabase()`, `closeDatabase()`, and utility functions (`generateId`, `serializeMetadata`, `now`)
- **Schema** (`src/database/schema.ts`): Versioned migrations (currently v5). Tables: `memories`, `entities`, `memory_entities` (M2M), `provenance`, `memories_fts` (FTS5 virtual table with triggers for sync)
- **Cache** (`src/cache/memory-cache.ts`): In-memory LRU cache (200 entries, 60s TTL) with invalidation on store/update/delete

### Auto-Processing Pipeline (on store)

Content → `normalizeContent()` → `generateSummary()` → `extractEntities()` + `classifyMemoryType()` → `calculateImportance()` → `calculateTTL()` → SQLite INSERT + FTS5 trigger

## Key Constraints

- **MCP uses stdout** — All logging must use `console.error`, never `console.log`
- **ESLint rule**: `no-console` warns except for `console.warn` and `console.error`
- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` — optional properties must explicitly include `undefined` in their type
- **ESM only** — `"type": "module"` in package.json, use `.js` extensions in imports
- **Husky pre-commit hook** runs lint + typecheck + tests + secrets scanning — all must pass before commit
- **Commitlint** enforces conventional commits: `<type>: <description>` (feat, fix, docs, refactor, test, chore, style, perf, ci, build, revert)
- **CI matrix** tests on Node 18/20/22 across ubuntu/windows/macos

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEMORY_DB_PATH` | Platform-specific (`~/.claude-memories/` on macOS, XDG on Linux, `%APPDATA%` on Windows) | Database location |
| `DEFAULT_TTL_DAYS` | `90` | Memory expiration |
| `MEMORY_DB_DRIVER` | `better-sqlite3` | Database driver selection |

## Testing

Tests live in `test/` (integration, `.js`) and `src/**/*.test.ts` (unit). Integration tests require a prior `npm run build` since they import `dist/index.js`. ESLint ignores `*.js` and `*.test.ts` files — only `src/**/*.ts` production code is linted.
