# Memory MCP v2.0

**Token-optimized brain-inspired memory system with dual-response progressive loading**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue)](https://www.typescriptlang.org/)
[![MCPB Ready](https://img.shields.io/badge/MCPB-Ready-green)](https://github.com/anthropics/mcpb)

## Overview

Memory MCP v2.0 is a complete TypeScript rewrite delivering **50% token savings** through intelligent dual-response architecture and SQLite FTS5 search. Built as an MCPB bundle for one-click installation in Claude Desktop.

### What's New in v2.0

🚀 **Dual-Response Pattern** - Index (all matches) + Details (within token budget)
🔍 **SQLite FTS5 Search** - Lightweight full-text search, no embedding bloat
⚡ **Token-Aware by Default** - `max_tokens` parameter for intelligent budgeting
📦 **~3MB Bundle** - No embedding models, pure FTS5 magic
🎯 **Skill-Pattern Architecture** - Discover what exists, load details selectively
✨ **Simplified API** - 5 parameters for clean, intuitive usage

### Key Features

✅ **Progressive Disclosure** - See summaries, then drill down
✅ **Automatic Summarization** - 20-word summaries for all memories
✅ **Importance-Based Retention** - Auto-scoring + TTL management
✅ **Provenance Tracking** - Full audit trail for trust & debugging
✅ **Hot Context Scoring** - Recent + frequent + important prioritization
✅ **MCPB Bundle** - One-click installation, auto-updates
✅ **Plugin System** - Extensible architecture

## Token Efficiency

### v2.0 Dual-Response Pattern

```typescript
memory_recall({ query: "Python", max_tokens: 1000 })

Returns:
{
  index: [...20 summaries],      // ~400 tokens (all matches)
  details: [...3 full memories], // ~600 tokens (top matches)
  total_count: 20,
  tokens_used: 950
}
```

**Benefits:**
- Claude always sees what memories exist (index)
- Claude gets full context for most relevant (details)
- Token budget automatically managed
- No guessing at detail levels

### Token Savings Comparison

| Scenario | v1.x (old) | v2.0 (new) | Savings |
|----------|------------|------------|---------|
| 10 matches, minimal | 300 tokens | 200 tokens | 33% |
| 10 matches, standard | 2000 tokens | 850 tokens | 57% |
| 50 matches, discovery | N/A | 1000 tokens | New |

### Response Component Costs

| Component | Tokens | Notes |
|-----------|--------|-------|
| Summary (index) | ~20 | 20-word auto-generated |
| Full memory (details) | ~200 | Content + metadata |
| Index (20 memories) | ~400 | All summaries |
| Details (3 memories) | ~600 | Full content |

## Installation

### Option 1: MCPB Bundle (Recommended)

1. Download `memory-mcp.mcpb` from [Releases](https://github.com/whenmoon-afk/claude-memory-mcp/releases)
2. Claude Desktop → Settings → Developer → Install unpacked extension
3. Select the `.mcpb` file

The MCPB installer handles:
- ✅ Dependency installation
- ✅ Database setup
- ✅ Skill loading
- ✅ Configuration

### Option 2: From Source

```bash
git clone https://github.com/whenmoon-afk/claude-memory-mcp.git
cd claude-memory-mcp
npm install
npm run build

# Add to Claude Desktop config:
# %APPDATA%\Claude\claude_desktop_config.json (Windows)
# ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["C:/path/to/claude-memory-mcp/dist/index.js"]
    }
  }
}
```

## Quick Start

Once installed, Claude automatically gains memory capabilities:

### 1. Store Memories
```typescript
// Create new memory (automatic features kick in)
memory_store({
  content: "User prefers TypeScript over JavaScript for type safety",
  type: "fact"
  // Auto-generated: 20-word summary
  // Auto-extracted: entities
  // Auto-calculated: importance score
})
```

### 2. Update Memories
```typescript
// Update existing (same tool, provide id)
memory_store({
  id: "mem_abc123",
  content: "User strongly prefers TypeScript for all projects",
  importance: 9 // Manual override
})
```

### 3. Search with Dual Response
```typescript
memory_recall({
  query: "What are the user's coding preferences?",
  max_tokens: 1000 // Token budget
})

// Returns:
{
  index: [
    { id: "mem_1", summary: "Prefers TypeScript over JavaScript..." },
    { id: "mem_2", summary: "Uses VS Code with Vim keybindings..." },
    // ... all matches as summaries
  ],
  details: [
    {
      id: "mem_1",
      content: "Full detailed content here...",
      summary: "Prefers TypeScript over JavaScript...",
      importance: 8,
      entities: ["TypeScript", "JavaScript"]
      // ... full memory data
    }
    // ... top matches within token budget
  ],
  total_count: 15,
  has_more: false,
  tokens_used: 850,
  query: "What are the user's coding preferences?"
}
```

### 4. Forget Memories
```typescript
// Soft delete (preserves provenance)
memory_forget({
  id: "mem_abc123",
  reason: "Outdated preference"
})

// Hard delete (permanent)
memory_forget({
  id: "mem_abc123",
  hard_delete: true
})
```

## Architecture

### v2.0 Dual-Response System

```
Memory MCP v2.0
├── Dual-Response Pattern
│   ├── Index: ALL matches as 20-word summaries (~20 tokens each)
│   │   - Always included
│   │   - Lets Claude see what exists
│   │   - Discovery-first approach
│   │
│   └── Details: Top matches with full content (~200 tokens each)
│       - Fills remaining token budget
│       - Hybrid scoring prioritizes best matches
│       - Automatic budget management
│
├── SQLite FTS5 Search
│   ├── Porter stemming for word variants
│   ├── Unicode normalization
│   ├── Automatic index synchronization
│   ├── Lightweight (~3MB bundle)
│   └── <10ms search latency
│
├── Hybrid Scoring Algorithm
│   ├── FTS rank (40%) - keyword relevance
│   ├── Importance (30%) - 0-10 user/auto score
│   ├── Recency (20%) - last access time
│   └── Frequency (10%) - access count
│
├── Database (SQLite)
│   ├── memories - Core storage with FTS5 indexing
│   ├── entities - Auto-extracted entities
│   ├── provenance - Complete audit trail
│   └── Automatic triggers keep FTS in sync
│
└── 3 Streamlined Tools
    ├── memory_store - Create/update (merged)
    ├── memory_recall - Search with dual response
    └── memory_forget - Soft or hard delete
```

### Database Schema (v2)

```sql
-- Core memory storage
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  summary TEXT NOT NULL,        -- Auto-generated 20-word summary
  type TEXT NOT NULL,            -- 'fact' | 'entity' | 'relationship' | 'self'
  importance REAL DEFAULT 5,     -- 0-10 scale
  created_at INTEGER NOT NULL,
  last_accessed INTEGER NOT NULL,
  access_count INTEGER DEFAULT 0,
  expires_at INTEGER,            -- TTL based on importance
  metadata TEXT DEFAULT '{}',
  is_deleted INTEGER DEFAULT 0
);

-- FTS5 virtual table for full-text search
CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED,
  content,
  summary,
  tokenize = 'porter unicode61'
);

-- Auto-sync triggers (INSERT, UPDATE, DELETE)
-- Keeps FTS index synchronized automatically

-- Extracted entities
CREATE TABLE entities (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_type TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);

-- Provenance audit trail
CREATE TABLE provenance (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  operation TEXT NOT NULL,   -- 'create' | 'update' | 'delete'
  timestamp INTEGER NOT NULL,
  metadata TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(id)
);
```

## Tools Reference

### `memory_store`

Store new or update existing memories with automatic extraction and summary generation.

**Parameters:**
```typescript
{
  // Update mode (provide id)
  id?: string;               // Memory ID to update

  // Create/Update
  content: string;           // Required: What to store
  type: 'fact' | 'entity' | 'relationship' | 'self'; // Required

  // Optional overrides (auto-calculated if omitted)
  importance?: number;       // 0-10 scale
  entities?: string[];       // Auto-extracted if omitted
  tags?: string[];           // Optional tags
}
```

**Returns:**
```typescript
{
  id: string;
  content: string;
  summary: string;           // Auto-generated 20-word summary
  type: string;
  importance: number;
  entities: string[];
  created_at: number;
  last_accessed: number;
  access_count: number;
  expires_at: number | null;
}
```

---

### `memory_recall`

Semantic search with dual response (index + details) and intelligent token budgeting.

**Parameters:**
```typescript
{
  query: string;             // Required: Natural language query
  max_tokens?: number;       // Token budget (default: 1000, range: 100-5000)
  type?: 'fact' | 'entity' | 'relationship' | 'self'; // Filter by type
  entities?: string[];       // Filter by entity names
  limit?: number;            // Max results (default: 20, max: 50)
}
```

**Returns (Dual Response):**
```typescript
{
  index: MinimalMemory[];    // ALL matches as summaries
  details: FormattedMemory[]; // Top matches with full content
  total_count: number;
  has_more: boolean;
  tokens_used: number;
  query: string;
}

// MinimalMemory (index): ~20 tokens each
{
  id: string;
  summary: string;           // 20-word summary
}

// FormattedMemory (details): ~200 tokens each
{
  id: string;
  content: string;           // Full content
  summary: string;
  type: string;
  importance: number;
  entities: string[];
  created_at: number;
  last_accessed: number;
  access_count: number;
}
```

---

### `memory_forget`

Delete or archive a memory with provenance tracking.

**Parameters:**
```typescript
{
  id?: string;               // Single memory ID
  ids?: string[];            // Multiple IDs for batch delete
  hard_delete?: boolean;     // Default: false (soft delete)
  reason?: string;           // Reason for deletion (stored in provenance)
}
```

**Soft delete** (default): Sets `is_deleted=1`, preserves data for audit trail
**Hard delete**: Permanently removes from database

**Returns:**
```typescript
{
  deleted_count: number;
  deleted_ids: string[];
}
```

## Usage Patterns

### Pattern 1: Discovery → Detail Loading
```typescript
// Step 1: Discover what exists
const result = memory_recall({
  query: "Python",
  max_tokens: 500  // Conservative budget
});

// Step 2: Review index (all matches)
console.log(`Found ${result.total_count} memories:`);
result.index.forEach(mem => {
  console.log(`- ${mem.summary}`);
});

// Step 3: Details already loaded for top matches
console.log(`Full details for top ${result.details.length}:`);
result.details.forEach(mem => {
  console.log(mem.content);
});
```

### Pattern 2: Token Budgeting
```typescript
// Quick lookup (300-500 tokens)
memory_recall({
  query: "user preferences",
  max_tokens: 500
  // Returns: index + 1-2 details
});

// Standard search (1000-1500 tokens)
memory_recall({
  query: "coding standards",
  max_tokens: 1500
  // Returns: index + 5-7 details
});

// Deep dive (3000-5000 tokens)
memory_recall({
  query: "project architecture",
  max_tokens: 5000
  // Returns: index + 20-25 details
});
```

### Pattern 3: Entity-Based Filtering
```typescript
// Find all memories related to specific entities
memory_recall({
  query: "programming",
  entities: ["Python", "FastAPI"],
  max_tokens: 2000
});
```

### Pattern 4: Type-Based Organization
```typescript
// Facts only
memory_recall({
  query: "API design",
  type: "fact",
  max_tokens: 1000
});

// Relationships only
memory_recall({
  query: "team structure",
  type: "relationship",
  max_tokens: 1000
});
```

### Pattern 5: Auto-Features
```typescript
// Let system handle everything (recommended)
memory_store({
  content: "User prefers dark mode for all applications",
  type: "self"
  // Auto-generated: summary, importance, entities
});

// Override only when necessary
memory_store({
  content: "CRITICAL: Production API endpoint migrated to v2",
  type: "fact",
  importance: 10,  // Manual override for critical info
  tags: ["production", "migration"]
});
```

## Best Practices

### ✅ DO

- Start with conservative `max_tokens` budgets (500-1000)
- Review `index` to understand what exists before drilling down
- Use entity filters to narrow search scope
- Set appropriate `importance` scores for critical information
- Use soft delete by default (preserves audit trail)
- Let auto-extraction work (override only when needed)

### ❌ DON'T

- Set `max_tokens` unnecessarily high (wastes context)
- Ignore the `index` field (it's designed for discovery)
- Over-tag memories (diminishing returns)
- Hard delete unless required (loses provenance)
- Store duplicate information (use update instead)

## Configuration

Environment variables:

```bash
MEMORY_DB_PATH=./memory.db           # Database location
DEBUG_MODE=false                     # Enable debug logging
```

Configuration via manifest.json (MCPB):

```json
{
  "configuration": {
    "MEMORY_DB_PATH": {
      "type": "string",
      "default": "~/.config/claude/memory-mcp/memory.db"
    },
    "DEBUG_MODE": {
      "type": "boolean",
      "default": false
    }
  }
}
```

## Development

### Setup
```bash
npm install
npm run build
```

### Build Scripts
```bash
npm run build          # Compile TypeScript
npm run typecheck      # Type checking only
npm run clean          # Remove dist/
npm test               # Run tests (if configured)
```

### Creating MCPB Bundle
```bash
node build-bundle.cjs  # Creates memory-mcp.mcpb
```

### Project Structure
```
claude-memory-mcp/
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── types/index.ts        # Core type definitions
│   ├── database/             # SQLite + schema
│   ├── tools/                # memory_store, memory_recall, memory_forget
│   ├── search/               # FTS5 semantic search
│   ├── extractors/           # Entity, fact, summary generation
│   ├── scoring/              # Importance, hot context, TTL
│   ├── core/                 # Context manager, plugin system
│   └── contexts/             # AI context files
├── skill/SKILL.md            # Expert knowledge for Claude
├── manifest.json             # MCPB manifest
├── package.json
├── tsconfig.json
└── build-bundle.cjs          # Bundle builder
```

## Troubleshooting

### Not finding memories?

Try broader search terms or remove filters:

```typescript
memory_recall({
  query: "python",  // Broader than "python fastapi type hints"
  max_tokens: 2000
  // Remove type and entity filters
});
```

### Token budget exhausted?

Increase `max_tokens` or reduce `limit`:

```typescript
memory_recall({
  query: "...",
  max_tokens: 3000,  // Increase budget
  limit: 10          // Or reduce results
});
```

### FTS5 not working?

Check SQLite version:

```bash
node -e "console.log(require('better-sqlite3')(':memory:').prepare('SELECT sqlite_version()').get())"
# Should be 3.35+ for FTS5 support
```

### Build errors?

Rebuild native bindings:

```bash
npm rebuild better-sqlite3 --build-from-source
```

## Migration from v1.x

**Breaking Changes from v1.x (Python) to v2.0 (TypeScript):**

1. **Platform:**
   - ✅ TypeScript + Node.js (was Python)
   - ✅ MCPB bundle support
   - ✅ One-click installation

2. **API Changes:**
   - ✅ `max_tokens` parameter for intelligent budgeting
   - ✅ Dual response structure (`index` + `details`)
   - ✅ Merged create/update into single `memory_store` tool
   - ✅ 3 tools (down from 6 in v1.x)

3. **Technology:**
   - ✅ SQLite FTS5 (built-in full-text search)
   - ✅ Lightweight ~3MB bundle
   - ✅ <10ms search latency

4. **Database:**
   - New SQLite schema with FTS5 support
   - Manual migration required from v1.x Python databases
   - Export from v1.x and import to v2.0 recommended

## Contributing

Contributions welcome! Areas of interest:

- Performance optimizations
- Additional scoring algorithms
- Export/import features
- Graph visualization
- Documentation improvements

See [CONTRIBUTING.md](CONTRIBUTING.md) (if exists)

## License

MIT License - see [LICENSE](LICENSE)

## Version History

**v2.0.0** (January 2025):
- Complete TypeScript rewrite from Python
- Dual-response pattern (index + details)
- SQLite FTS5 full-text search
- Token-aware with `max_tokens` parameter
- 50% token reduction vs v1.x
- MCPB bundle support (~3MB)
- 3 streamlined tools (down from 6)
- Automatic entity extraction and importance scoring

**v1.x** (2024):
- Python implementation
- 6 separate tools
- Basic memory storage and retrieval

---

**Built with ❤️ for the MCP ecosystem**
