# Memory MCP v2.0 - Developer Guide

> **Token-optimized brain-inspired memory system for Claude with dual-response progressive loading**

---

## Project Overview

Memory MCP v2.0 is a **complete TypeScript rewrite** (January 2025) with token efficiency as the core design principle.

**Key Features:**
- **Dual-response pattern**: Index (all matches as summaries) + Details (full content within token budget)
- **SQLite FTS5 search**: No embedding bloat, lightweight ~6MB bundle
- **Token-aware by default**: `max_tokens` parameter for intelligent budgeting
- **3 streamlined tools**: memory_store, memory_recall, memory_forget
- **50% token reduction** vs previous versions

---

## Quick Start

### Development
```bash
npm install
npm run build
npm run dev      # Watch mode
npm test         # Run tests
npm run lint     # Check code quality
```

### Building MCPB Bundle
```bash
node build-bundle.cjs
# Produces: memory-mcp-v2.0.0.mcpb (~6MB)
```

### Testing Locally
Add to Claude Desktop config (`~/.config/Claude/claude_desktop_config.json` or Windows equivalent):
```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["C:/Users/LocalUser/Documents/Github/claude-memory-mcp/dist/index.js"]
    }
  }
}
```

---

## Architecture

### Core Principles
1. **Token efficiency is paramount** - Every design decision considers token cost
2. **Dual-response pattern** - Always return index (summaries) + details (full content)
3. **Progressive disclosure** - Load only what fits in token budget
4. **Local-first** - No external APIs, SQLite FTS5 for search
5. **Provenance tracking** - Complete audit trail for all memory operations

### Technology Stack
- **TypeScript** with strict type safety
- **better-sqlite3** for local persistence (includes native bindings)
- **SQLite FTS5** for full-text search (porter stemming, unicode61 tokenization)
- **MCP SDK** (@modelcontextprotocol/sdk) for protocol compliance
- **No vector embeddings** - Removed @xenova/transformers to reduce bundle from 86MB to 6MB

### Project Structure
```
src/
├── index.ts                    # MCP server entry point, tool registration
├── types/index.ts              # Core type definitions
├── database/
│   ├── connection.ts           # DB utilities (init, serialize, generateId)
│   └── schema.ts               # Schema + migrations (v1→v2→v3)
├── tools/
│   ├── memory-store.ts         # Store/update tool
│   ├── memory-recall.ts        # Search tool (dual-response)
│   ├── memory-forget.ts        # Delete tool
│   └── response-formatter.ts   # Format memories for output
├── search/
│   └── semantic-search.ts      # FTS5 hybrid search implementation
├── extractors/
│   ├── entity-extractor.ts     # Pattern-based entity extraction
│   ├── fact-extractor.ts       # Fact extraction
│   └── summary-generator.ts    # 20-word summary generation
├── scoring/
│   ├── importance.ts           # Importance scoring (0-10)
│   ├── hot-score.ts            # Hot context scoring
│   └── ttl-manager.ts          # TTL calculation
├── core/
│   ├── context-manager.ts      # Progressive context loading
│   └── plugin-manager.ts       # Hook system for extensibility
├── contexts/                   # AI context files (loaded per operation)
│   ├── minimal.md              # Core overview
│   ├── extraction.md           # Entity/fact extraction
│   ├── scoring.md              # Importance/hot scoring
│   └── search.md               # Search algorithm
└── utils/
    └── token-estimator.ts      # Token counting utilities
```

---

## The 3 MCP Tools

### 1. memory_store
Create or update memories with automatic processing.

**Usage:**
```typescript
// Create new memory (omit id)
memory_store({
  content: "User prefers TypeScript over JavaScript for type safety",
  type: "self"
})

// Update existing memory (provide id)
memory_store({
  id: "mem_abc123",
  content: "Updated preference: TypeScript with strict mode enabled"
})
```

**Auto-processing:**
- Generates 20-word summary
- Extracts entities (people, places, technologies)
- Calculates importance score (0-10)
- Sets TTL based on importance

### 2. memory_recall
Semantic search with dual-response pattern.

**Usage:**
```typescript
memory_recall({
  query: "What are the user's TypeScript preferences?",
  max_tokens: 1000  // Budget for response
})

// Returns:
{
  index: [
    { id: "mem_1", summary: "Prefers TypeScript over JavaScript..." },
    { id: "mem_2", summary: "Uses strict mode extensively..." },
    // ... all matches as 20-word summaries (~20 tokens each)
  ],
  details: [
    {
      id: "mem_1",
      content: "Full detailed content...",
      importance: 8,
      entities: ["TypeScript", "JavaScript"]
      // ... full memory object (~200 tokens)
    }
    // ... top matches with full content (fills remaining budget)
  ],
  total_count: 20,
  tokens_used: 950
}
```

**Benefits:**
- Claude always sees what memories exist (index)
- Claude gets full context for most relevant memories (details)
- Token budget automatically managed
- No guessing at detail levels

### 3. memory_forget
Delete or archive memories.

**Usage:**
```typescript
// Soft delete (preserves provenance)
memory_forget({
  id: "mem_abc123",
  reason: "Outdated information"
})

// Hard delete (permanent)
memory_forget({
  id: "mem_abc123",
  hard_delete: true,
  reason: "User requested removal"
})

// Batch delete
memory_forget({
  ids: ["mem_1", "mem_2", "mem_3"],
  reason: "Cleanup old memories"
})
```

---

## Database Schema (v3)

### Tables

**memories** (main storage):
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,        -- Auto-generated 20-word summary
  type TEXT NOT NULL,            -- fact|entity|relationship|self
  importance REAL DEFAULT 5,     -- 0-10 scale
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  expires_at INTEGER,            -- TTL based on importance
  metadata TEXT,                 -- JSON blob
  is_deleted INTEGER DEFAULT 0   -- Soft delete flag
);
```

**memories_fts** (FTS5 virtual table):
```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  summary,
  tokenize = 'porter unicode61'
);
```

**Automatic FTS synchronization via triggers:**
- INSERT → Add to FTS
- UPDATE content/summary → Update FTS
- UPDATE is_deleted=1 → Remove from FTS
- DELETE → Remove from FTS

**Hybrid Scoring Algorithm:**
```
final_score = (fts_rank × 0.4) + (importance × 0.3) + (recency × 0.2) + (frequency × 0.1)
```

---

## Token Efficiency Guidelines

### Response Sizes
| Component | Tokens | Notes |
|-----------|--------|-------|
| Summary (index) | ~20 | 20-word auto-generated |
| Full memory (details) | ~200 | Content + metadata |
| Index (20 memories) | ~400 | All summaries |
| Details (3 memories) | ~600 | Full content |

### Budgeting Recommendations
- **Quick lookup**: 300-500 tokens (index + 1-2 details)
- **Standard search**: 1000-1500 tokens (index + 5-7 details)
- **Deep dive**: 3000-5000 tokens (index + 15-25 details)

### Token Savings vs v1.x
| Scenario | v1.x (old) | v2.0 (new) | Savings |
|----------|------------|------------|---------|
| 10 matches, minimal | 300 tokens | 200 tokens | 33% |
| 10 matches, standard | 2000 tokens | 850 tokens | 57% |
| 50 matches, discovery | N/A | 1000 tokens | New capability |

---

## Common Development Tasks

### Add New Memory Type
1. Update `MemoryType` enum in `src/types/index.ts`
2. Update tool schemas in `src/index.ts`
3. Add type-specific extraction logic in `src/extractors/`

### Modify Scoring Algorithm
Edit `src/search/semantic-search.ts`:
```typescript
const hybridScore =
  (result.ftsRank * 0.4) +
  (result.importance * 0.3) +
  (result.recency * 0.2) +
  (result.frequency * 0.1);
  // Adjust weights (must sum to 1.0)
```

### Add New Tool
1. Create `src/tools/your-tool.ts`
2. Implement function with proper types
3. Register in `src/index.ts`
4. Update `manifest.json` and `mcpb/manifest.json`

---

## Testing & Validation

### Manual Testing
```typescript
// Test memory_store
memory_store({
  content: "Test memory content",
  type: "fact",
  tags: ["test"]
})

// Test memory_recall with token budgeting
memory_recall({
  query: "test",
  max_tokens: 500
})
// Verify: index has all matches, details fits budget, tokens_used <= max_tokens

// Test memory_forget
memory_forget({
  id: "mem_xxx",
  reason: "test cleanup"
})
```

### Build Verification
```bash
# Clean build
npm run clean && npm install && npm run build

# Verify output
ls -la dist/
echo $?  # Should be 0
```

### Bundle Testing
```bash
# Create bundle
node build-bundle.cjs

# Verify size (~6MB is expected)
ls -lh memory-mcp-v2.0.0.mcpb

# Test installation
# 1. Open Claude Desktop
# 2. Settings → Developer → Install unpacked extension
# 3. Select the .mcpb file
# 4. Test all 3 tools work correctly
```

---

## Deployment & Release

### Release Checklist
- [ ] Update version in `package.json`, `manifest.json`, `mcpb/manifest.json`
- [ ] Update `RELEASE_NOTES.md`
- [ ] Run `npm run build` (verify no errors)
- [ ] Run `node build-bundle.cjs` (verify bundle created)
- [ ] Test local MCP server works
- [ ] Test MCPB bundle installs and works
- [ ] Create git commit and tag
- [ ] Push to GitHub
- [ ] Create GitHub release with .mcpb artifact

### GitHub Release Workflow
```bash
# 1. Update versions
# 2. Build and test
npm run build
node build-bundle.cjs

# 3. Commit and tag
git add .
git commit -m "Release v2.x.x: Description"
git tag v2.x.x

# 4. Push
git push && git push --tags

# 5. Create GitHub release and attach memory-mcp-v2.x.x.mcpb
```

---

## Troubleshooting

### "Module not found" errors
- Check `package.json` has `"type": "module"`
- Ensure imports use `.js` extensions: `import { x } from './file.js'`
- Verify tsconfig.json: `"module": "Node16"`, `"moduleResolution": "Node16"`

### better-sqlite3 native binding errors
```bash
npm rebuild better-sqlite3 --build-from-source
```

### FTS5 search not working
- Check SQLite version: Should be 3.35+ (has FTS5)
- Verify triggers: Check `memories_fts` table is populated
- Check FTS5 is enabled: Run test query in DB

### Bundle too large (>10MB)
- Check `.mcpbignore` excludes dev files
- Verify no devDependencies in production build
- Check node_modules only has production deps

### TypeScript compilation errors
```bash
npm run typecheck  # See detailed errors
```

---

## Key Design Decisions

### Why Remove Vector Embeddings?
**Problem**: @xenova/transformers added ~80MB to bundle
**Solution**: SQLite FTS5 with hybrid scoring
**Result**: 96% size reduction (86MB → 6MB), <10ms search latency

### Why Dual-Response Pattern?
**Problem**: Fixed detail levels were inflexible
**Solution**: Always return index + fill budget with details
**Benefits**: Discovery + context, automatic token management

### Why Merge Create/Update?
**Problem**: Separate tools were redundant
**Solution**: Single `memory_store`, `id` determines operation
**Benefits**: Simpler API, less context overhead

---

## Critical Reminders

1. **Token efficiency is paramount** - Every change should consider token impact
2. **Maintain dual-response pattern** - Index + details is core architecture
3. **Keep FTS5 triggers synchronized** - Auto-sync is critical for correctness
4. **Preserve provenance** - Soft delete by default, audit trail matters
5. **Test with real data** - Token estimates must be validated
6. **Document token costs** - New features should document token impact

---

## Version History

**v2.0.0** (January 2025):
- Complete TypeScript rewrite from Python
- Dual-response pattern (index + details)
- SQLite FTS5 full-text search (removed embeddings)
- Token-aware with `max_tokens` parameter
- 50% token reduction vs v1.x
- MCPB bundle support (~6MB)
- 3 streamlined tools (down from 6)
- Automatic entity extraction and importance scoring

**v1.x** (2024):
- Python implementation
- Vector embeddings with @xenova/transformers
- 6 separate tools
- Basic memory storage and retrieval
