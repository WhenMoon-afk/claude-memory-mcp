# Claude Memory MCP - Project Structure

## Overview
Memory MCP v2.0 - A token-optimized brain-inspired memory system for Claude built as an MCP Bundle.

---

## Root Level Files

### Configuration & Build
- **package.json** - Node.js dependencies, scripts, and project metadata
- **package-lock.json** - Locked dependency versions
- **tsconfig.json** - TypeScript compiler configuration (strict mode enabled)
- **vitest.config.ts** - Vitest testing framework configuration
- **.eslintrc.json** - ESLint code linting rules
- **.prettierrc.json** - Prettier code formatting rules
- **.gitignore** - Git ignore patterns
- **.mcpbignore** - MCPB bundle ignore patterns

### Documentation
- **README.md** - Main project documentation, usage examples, installation
- **CLAUDE.md** - Development instructions for Claude Code (comprehensive implementation spec)
- **MCPB.md** - MCPB bundle documentation
- **RELEASE_NOTES.md** - Version history and release information
- **LICENSE** - Project license

### Manifests
- **manifest.json** - Root MCPB manifest (v0.3 spec)
- **mcpb/manifest.json** - MCPB bundle manifest with tool definitions

### Build Artifacts
- **claude-memory-mcp.mcpb** - Compiled MCPB bundle (distributable)
- **memory.db** - SQLite database (runtime, gitignored)

---

## Directory Structure

```
claude-memory-mcp/
├── .claude/                    # Claude Code local settings
│   └── settings.local.json
│
├── .github/                    # GitHub Actions workflows
│   └── workflows/
│       └── release-mcpb.yml    # MCPB release automation
│
├── mcpb/                       # MCPB bundle configuration
│   └── manifest.json           # Bundle manifest (tools, config)
│
├── skill/                      # Claude Desktop skill definition
│   └── SKILL.md                # Skill documentation and usage
│
├── src/                        # TypeScript source code
│   ├── contexts/               # Progressive context loading (93% token savings)
│   │   ├── extraction.md       # 2k tokens - Entity/fact extraction context
│   │   ├── minimal.md          # 1k tokens - Always-loaded base context
│   │   ├── scoring.md          # 1k tokens - Importance/TTL scoring context
│   │   └── search.md           # 3k tokens - Semantic search context
│   │
│   ├── core/                   # System-level managers
│   │   ├── context-manager.ts  # Smart context loading orchestration
│   │   └── plugin-manager.ts   # Plugin hook system
│   │
│   ├── database/               # SQLite persistence layer
│   │   ├── connection.ts       # Connection, utilities, serialization
│   │   └── schema.ts           # Schema definition, migrations, indexes
│   │
│   ├── extractors/             # Auto-extraction pipeline
│   │   ├── entity-extractor.ts       # Named entity extraction
│   │   ├── fact-extractor.ts         # Discrete fact extraction
│   │   ├── relationship-extractor.ts # Entity relationship mapping
│   │   └── summary-generator.ts      # 20-word summary generation
│   │
│   ├── scoring/                # Intelligence algorithms
│   │   ├── hot-score.ts        # Hot context relevance scoring
│   │   ├── importance.ts       # Importance calculation (0-10 scale)
│   │   └── ttl-manager.ts      # Dynamic TTL/retention logic
│   │
│   ├── search/                 # Semantic search system
│   │   ├── embeddings.ts       # @xenova/transformers wrapper
│   │   └── semantic-search.ts  # Cosine similarity, hybrid scoring
│   │
│   ├── tools/                  # MCP tool implementations (6 tools)
│   │   ├── hot-context.ts      # Get high-relevance context (<150 tokens)
│   │   ├── memory-forget.ts    # Delete/archive memories
│   │   ├── memory-recall.ts    # Search and retrieve (tiered detail levels)
│   │   ├── memory-store.ts     # Create/update memories
│   │   ├── memory-update.ts    # Update existing memories
│   │   ├── prune-expired.ts    # Clean up expired memories
│   │   └── response-formatter.ts # Format memories by detail level
│   │
│   ├── utils/                  # Utility functions
│   │   └── token-estimator.ts  # Token counting for budget management
│   │
│   ├── types/                  # TypeScript type definitions
│   │   └── index.ts            # All types (single source of truth)
│   │
│   └── index.ts                # MCP server entry point (stdio transport)
│
└── node_modules/               # Dependencies (generated, gitignored)
```

---

## Key File Purposes

### Entry Point
- **src/index.ts** - MCP server initialization, tool routing, stdio transport

### Database Layer
- **src/database/schema.ts** - 4 tables: memories, entities, memory_entities, provenance
- **src/database/connection.ts** - ID generation, serialization helpers, transactions

### Smart Context System (Token Optimization)
- **src/contexts/minimal.md** - Base context loaded for all operations (1k tokens)
- **src/contexts/extraction.md** - Loaded for memory_store operations (2k tokens)
- **src/contexts/scoring.md** - Loaded for importance/TTL calculations (1k tokens)
- **src/contexts/search.md** - Loaded for memory_recall operations (3k tokens)
- **src/core/context-manager.ts** - Orchestrates lazy loading, 5-minute cache

### Extraction Pipeline
- **src/extractors/entity-extractor.ts** - Extracts people, orgs, tech, locations
- **src/extractors/fact-extractor.ts** - Extracts discrete facts from content
- **src/extractors/relationship-extractor.ts** - Maps connections between entities
- **src/extractors/summary-generator.ts** - Generates 15-20 word summaries

### Intelligence Layer
- **src/scoring/importance.ts** - Auto-calculates importance (0-10) from content complexity, entities, type
- **src/scoring/ttl-manager.ts** - Dynamic retention based on importance and access patterns
- **src/scoring/hot-score.ts** - Relevance scoring: `0.4*importance + 0.3*recency + 0.3*frequency`

### Search System
- **src/search/embeddings.ts** - Local embeddings via Xenova/all-MiniLM-L6-v2 (384d)
- **src/search/semantic-search.ts** - Cosine similarity + hybrid scoring algorithm

### MCP Tools (6 Total)
1. **memory-store** - Create/update memories with auto-extraction
2. **memory-recall** - Semantic search with tiered detail levels (minimal/standard/full)
3. **hot-context** - Get most relevant memories for current context (<150 tokens)
4. **memory-update** - Update specific memory fields
5. **memory-forget** - Soft delete or hard delete memories
6. **prune-expired** - Cleanup utility for TTL-expired memories

### Response Formatting
- **src/tools/response-formatter.ts** - Tiered response system:
  - **Minimal**: ~30 tokens (id, type, summary, importance)
  - **Standard**: ~200 tokens (+ content, entities, timestamps)
  - **Full**: ~500 tokens (+ tags, access_count, provenance, expires_at)

### Type System
- **src/types/index.ts** - Comprehensive TypeScript types for entire system

### Utilities
- **src/utils/token-estimator.ts** - Token counting (length/4 heuristic) for budget validation

---

## Database Schema

### Tables
1. **memories** - Core memory storage (content, embeddings, importance, TTL)
2. **entities** - Named entity registry (people, orgs, tech, locations, concepts)
3. **memory_entities** - Many-to-many join table
4. **provenance** - Full audit trail (create/update/delete/access events)

### Key Indexes
- `idx_memories_hot_context` - (last_accessed DESC, importance DESC)
- `idx_memories_type` - Fast filtering by memory type
- `idx_entities_name` - Entity lookup
- `idx_memory_entities_memory_id` - Entity-to-memory mapping
- `idx_memory_entities_entity_id` - Memory-to-entity mapping

---

## MCPB Bundle Structure

When `mcpb pack` is run, creates:

```
claude-memory-mcp.mcpb (zip archive)
├── manifest.json           # Root manifest
├── dist/                   # Compiled JavaScript
│   ├── index.js           # Entry point
│   ├── contexts/          # Context .md files (copied)
│   ├── skill/             # Skill documentation (copied)
│   └── [all compiled .js] # TypeScript → JavaScript
└── node_modules/          # Production dependencies
```

---

## Build Pipeline

1. **TypeScript Compilation**: `tsc` → `dist/`
2. **Context Copy**: `src/contexts/*.md` → `dist/contexts/`
3. **Skill Copy**: `skill/SKILL.md` → `dist/skill/`
4. **MCPB Packaging**: `mcpb pack` → `claude-memory-mcp.mcpb`

---

## Development Workflow

### Scripts (package.json)
- `npm install` - Install dependencies
- `npm run dev` - Development mode with watch
- `npm run build` - Compile TypeScript + copy assets
- `npm run typecheck` - Type checking (no emit)
- `npm test` - Run Vitest tests
- `npm run lint` - ESLint check
- `npm run format` - Prettier formatting
- `mcpb pack` - Create MCPB bundle

### Testing
- Framework: Vitest (configured in vitest.config.ts)
- Timeout: 30 seconds (embeddings slow on first run)
- Coverage: Excludes dist/, node_modules/

---

## Configuration Files

### TypeScript (tsconfig.json)
- Target: ES2022
- Module: CommonJS
- Strict mode: Enabled
- Output: dist/

### ESLint (.eslintrc.json)
- TypeScript parser
- Recommended rules
- Strict linting

### Prettier (.prettierrc.json)
- Code formatting standards
- Consistent style across codebase

### Vitest (vitest.config.ts)
- Test configuration
- Coverage settings
- Timeout configuration

---

## Environment Variables

Set in MCPB manifest or manually:
- `MEMORY_DB_PATH` - Database location (default: ./memory.db)
- `EMBEDDING_MODEL` - Transformers model (default: Xenova/all-MiniLM-L6-v2)
- `DEFAULT_TTL_DAYS` - Retention period (default: 90)
- `HOT_CONTEXT_LIMIT` - Max hot context items (default: 20)
- `ENABLE_AUTO_CAPTURE` - Auto-extract facts (default: true)
- `CACHE_CONTEXT_MINUTES` - Context cache duration (default: 5)
- `SEARCH_BATCH_SIZE` - Max search candidates (default: 100)

---

## Token Budget Strategy

### Progressive Context Loading
- **Base**: minimal.md (1k) - always loaded
- **Store**: + extraction.md (2k) + scoring.md (1k) = 4k total
- **Recall**: + search.md (3k) = 4k total
- **Update**: + extraction.md (2k) + scoring.md (1k) = 4k total

### Response Tiers
- **Minimal**: 30 tokens per memory (summaries only)
- **Standard**: 200 tokens per memory (content + metadata)
- **Full**: 500 tokens per memory (everything + provenance)

### Hot Context Budget
- Target: <150 tokens total
- Uses minimal format (30 tokens/memory)
- Fits ~5 high-relevance memories

**Total Savings**: 93% reduction vs. naive full-context loading (4-6k vs 50k tokens)

---

## Architecture Principles

1. **Smart Monolith** - Single process, not microservices
2. **Progressive Context** - Load only what's needed
3. **Token Efficiency** - Every token counts
4. **Local Embeddings** - No external API calls
5. **Provenance Tracking** - Full audit trail
6. **Plugin Extensibility** - Hook-based customization
7. **MCP Standard** - Protocol-compliant stdio transport
8. **MCPB Distribution** - One-click installation

---

## Critical Patterns

1. **Database Initialization** - Must be inside `main()` function (not module level)
2. **MCP Protocol** - JSON-RPC 2.0 via stdin/stdout (stderr for logs only)
3. **Type Safety** - Strict TypeScript, no `any` types
4. **Error Handling** - Throw McpError with proper codes
5. **Serialization** - Use helpers for embeddings, metadata, IDs
6. **Transactions** - Use for multi-step database operations
7. **Soft Deletes** - Set `is_deleted=1`, preserve provenance

---

## Git Status Snapshot

### Staged for Commit
- New: ESLint, Prettier configs, GitHub workflow, manifest files, TypeScript source
- Modified: README, CLAUDE.md, .gitignore, package.json
- Deleted: Old Python implementation, Docker files, old docs

### Untracked
- summary-generator.ts, hot-score.ts, response-formatter.ts, token-estimator.ts
- (Phase 1 implementation files)

---

## Dependencies

### Production
- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `@xenova/transformers` - Local embedding generation
- `better-sqlite3` - SQLite database driver

### Development
- TypeScript, ESLint, Prettier
- Vitest (testing framework)
- @anthropic-ai/mcpb (bundle creation)

---

## Next Steps (Implementation Order)

Per CLAUDE.md Phase 1-6:
1. **Phase 1**: Response optimization (summary generator, formatters)
2. **Phase 2**: Hot context optimization (scoring, token budget)
3. **Phase 3**: Tool consolidation (merge create/update)
4. **Phase 4**: Pagination & performance
5. **Phase 5**: Testing & validation
6. **Phase 6**: Documentation finalization

---

*Generated: 2025-11-02*
*Total Files: 49 (excluding node_modules)*
*Lines of Code: ~3000+ TypeScript (estimated)*
