# CLAUDE.md

## What This Is

Identity persistence MCP server for AI agents. Published to npm as `@whenmoon-afk/memory-mcp`. Three MCP tools: `reflect` (session-end concept extraction + promotion scoring), `anchor` (explicit identity file writing), `self` (query current identity state).

## Commands

```bash
npm test               # Run vitest tests (45 tests)
npm run test:watch     # Vitest in watch mode
npm run typecheck      # TypeScript strict mode check
npm run build          # Compile TypeScript → dist/
npm run dev            # Watch mode with tsx
npm start              # Run MCP server (stdio transport)
```

## Architecture

```
MCP Client → index.ts (registerTool + Zod) → tools/*.ts → observations.ts + identity.ts
```

- **Entry** (`src/index.ts`): McpServer from `@modelcontextprotocol/sdk/server/mcp.js`, three tools registered via `registerTool()`
- **Tools** (`src/tools/`): `reflect.ts` records concepts + runs promotion, `anchor.ts` writes to identity files, `self.ts` reads all identity state
- **Observation store** (`src/observations.ts`): JSON file tracking concept frequency. Promotion formula: `score = total_recalls * log2(distinct_days + 1) * context_diversity * recency_weight`
- **Identity files** (`src/identity.ts`): Manages `soul.md` (carved), `self-state.md` (written), `identity-anchors.md` (grown)
- **Paths** (`src/paths.ts`): XDG-compliant data directory resolution

## Key Constraints

- **MCP uses stdout** — logging must use `console.error`, never `console.log`
- **TypeScript strict mode** with `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`
- **ESM only** — `"type": "module"`, use `.js` extensions in imports
- **No database** — JSON observation store + markdown identity files
- **Pre-commit hook** runs typecheck + tests + secret scanning

## Development Practices

- **TDD**: Test first, watch it fail, minimal implementation, verify green
- **Systematic debugging**: Root cause investigation before fixes. No guessing.
- **No over-engineering**: Ship what's needed, nothing more

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `XDG_DATA_HOME` | `~/.local/share` | Base data directory |

Data stored at `$XDG_DATA_HOME/claude-memory/` (observations.json + identity/).
