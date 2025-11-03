# Memory MCP v2.0
 
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview

Memory MCP v2.0 is a complete TypeScript rewrite delivering major token savings through intelligent dual-response architecture and SQLite FTS5 search. 
Planned to be built as an MCPB bundle for one-click installation in Claude Desktop and other MCP Clients.
Token-optimized brain-inspired memory system with smart layered loading of information.
Designed to be an option for a local-only mcp server upgrade to native memory for mcp clients such as claude desktop.
Currently your database is not encrypted, it is stored locally and you are responsible for managing it.

Layer 1: "I know what I know all the time. I also know how I generally feel towards the most important people I know."
    -> Active context, hyper token efficient and summarized, maximum broad understanding but no depth or fine details or memories. 
Layer 2: "I can choose to think about something I know and recall greater details about the memory or skill."
Layer 3: "I can really think back to when I learned the skill or experienced the memory, and recall what context existed around when I acquired that memory "



The goals of this implementation are to maximize token efficiency. It is also designed so that it can work together apart of a modularized set of systems modeling the architecture of the human brain. It works alongside of the Native memory that Claude has/will have soon, and aims to enhance memory rather than replace it. It can store memories that are learned from searching past conversations or if you load a snapshot from a previous conversation.



### What's New in v2.0

🚀 **Dual-Response Pattern** - Index (all matches) + Details (within token budget)
🔍 **SQLite FTS5 Search** - Lightweight full-text search, no embedding bloat
⚡ **Token-Aware by Default** - `max_tokens` parameter for intelligent budgeting
🎯 **Skill-Pattern Architecture** - Discover what exists, load details selectively
✨ **Simplified API** - 5 parameters for clean, intuitive usage

### Key Features

✅ **Progressive Disclosure** - See summaries, then drill down
✅ **Automatic Summarization** - 20-word summaries for all memories
✅ **Importance-Based Retention** - Auto-scoring + TTL management
✅ **Provenance Tracking** - Full audit trail for trust & debugging
✅ **Hot Context Scoring** - Recent + frequent + important prioritization
✅ **Memory source provenance**: Be able to track the source of what inspired a memory to be stored
✅ **Strategic layers** of context that the model can query as needed to gain more information but only if needed.



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

Once installed reload you must "Reload MCP Configuration" (or completely close and restart) for your MCP Client (such as claude desktop)

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
  
    

## Version History

**v2.0.0** (Nov 3, 2025):
- Complete TypeScript rewrite from Python
- Dual-response pattern (index + details)
- SQLite FTS5 full-text search
- Token-aware with `max_tokens` parameter
- Automatic entity extraction and importance scoring
- Utilizes database storage to allow for memory retreival without context bloat


- ~~MCPB bundle support~~ Work in Progress


**v1.x.x** (Apr 29, 2025):
- Basic memory storage and retrieval
- Outdated MCP Specification
- Single JSON file storage
- Response times ~2 seconds when memory json file grew too big
- Full JSON file is returned to model context -> Inefficient token consumption

---

## License

MIT License


