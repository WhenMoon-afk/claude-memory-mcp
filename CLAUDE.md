# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

MCP server providing persistent memory for Claude Desktop and MCP-compatible AI assistants. Published to npm as `@whenmoon-afk/memory-mcp`.

Part of the [Substratia](https://substratia.io) memory infrastructure ecosystem.

## Commands

```bash
npm install            # Install deps (compiles better-sqlite3)
npm run build          # Compile TypeScript
npm test               # Run vitest tests
npm run dev            # Watch mode with tsx
npm run lint           # ESLint
npm run lint:fix       # ESLint with auto-fix
npm run typecheck      # TypeScript type checking only
npm run format         # Prettier formatting
npm start              # Run compiled server
```

## Project Structure

```
src/
├── index.ts           # MCP server entry point, tool definitions
├── database/          # SQLite layer (better-sqlite3, FTS5)
├── extractors/        # Entity extraction from memory content
├── scoring/           # Hybrid relevance scoring (recency + importance + frequency)
├── search/            # FTS5 full-text search implementation
├── tools/             # MCP tool implementations
├── types/             # TypeScript interfaces
└── utils/             # Shared utilities
```

## Architecture

- **MCP SDK**: `@modelcontextprotocol/sdk` for protocol handling
- **Storage**: SQLite via `better-sqlite3` with FTS5 for full-text search
- **No embeddings**: Uses FTS5 instead of vector embeddings (faster, no API calls)
- **Soft deletes**: Memories are marked deleted, not removed (audit trail)

### MCP Tools

| Tool | Purpose |
|------|---------|
| `memory_store` | Store memory with auto-summarization and entity extraction |
| `memory_recall` | Search memories with token-aware loading |
| `memory_forget` | Soft-delete a memory |

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MEMORY_DB_PATH` | `~/.memory-mcp/memory.db` | Database location |
| `DEFAULT_TTL_DAYS` | `90` | Memory expiration |

## Testing

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage report
```

Tests use vitest. Test files are in `test/`.

## Publishing

```bash
npm run release             # Run tests + build
npm publish                 # Publish to npm (requires auth)
```

Package is published as `@whenmoon-afk/memory-mcp` with public access.

## Key Constraints

- **MCP uses stdout** - All logging must use `console.error`, not `console.log`
- **Node 18+** required (for native better-sqlite3)
- **First npm install** compiles native SQLite bindings (may take time)
