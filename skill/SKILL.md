# Memory MCP v3.0 - Expert Knowledge

## Core Design Philosophy

**Token-Aware by Default**: Every response is designed for maximum value per token.

**Skill-Pattern Architecture**: Like discovering available skills, you first see what memories exist (index), then load full details only when needed.

**Progressive Disclosure**: Start minimal, drill down selectively.

---

## Tools (3)

### 1. memory_store
**Purpose**: Create or update memories with automatic intelligence.

**Usage**:
```typescript
// Create new memory (omit id)
memory_store({
  content: "User prefers TypeScript over JavaScript for type safety",
  type: "fact",
  tags: ["coding", "preferences"]
})

// Update existing memory (provide id)
memory_store({
  id: "mem_abc123",
  content: "Updated content here",
  importance: 8  // Optional manual override
})
```

**Auto-features**:
- 20-word summary generation
- Entity extraction from content
- Importance scoring (0-10)
- TTL calculation based on importance
- Provenance tracking

**Parameters**:
- `content` (required): Memory text
- `type` (required): "fact" | "entity" | "relationship" | "self"
- `id` (optional): Provide to update, omit to create
- `tags` (optional): Array of strings for categorization
- `importance` (optional): 0-10, auto-calculated if omitted
- `entities` (optional): Array of entity names, auto-extracted if omitted

---

### 2. memory_recall
**Purpose**: Semantic search with intelligent token budgeting.

**The Dual-Response Pattern**:
```typescript
memory_recall({
  query: "What are the user's coding preferences?",
  max_tokens: 1000
})

// Returns:
{
  index: [
    { id: "mem_1", summary: "Prefers TypeScript over JavaScript for type safety" },
    { id: "mem_2", summary: "Uses VS Code with Vim keybindings" },
    { id: "mem_3", summary: "Follows functional programming patterns" }
    // ... all matches as 20-word summaries (~20 tokens each)
  ],
  details: [
    {
      id: "mem_1",
      content: "Full detailed content here...",
      summary: "Prefers TypeScript over JavaScript for type safety",
      importance: 8,
      entities: ["TypeScript", "JavaScript"],
      created_at: 1699012345000
    }
    // ... top matches with full content (fills remaining token budget)
  ],
  total_count: 47,
  has_more: true,
  tokens_used: 850,
  query: "What are the user's coding preferences?"
}
```

**How It Works**:
1. **Index First**: Always get summaries of ALL matching memories (~20 tokens each)
2. **Budget Filling**: Automatically loads full content for top matches until `max_tokens` budget is exhausted
3. **Smart Prioritization**: Hybrid scoring combines FTS rank + importance + recency + access frequency

**Parameters**:
- `query` (required): Natural language search query
- `max_tokens` (optional): Token budget for response (default: 1000, range: 100-5000)
- `type` (optional): Filter by "fact" | "entity" | "relationship" | "self"
- `entities` (optional): Filter by entity names (array)
- `limit` (optional): Max results to return (default: 20, max: 50)

**Token Efficiency**:
- **Index**: ~20 tokens per memory (just the summary)
- **Details**: ~200 tokens per memory (full context)
- **50% reduction** vs previous versions

---

### 3. memory_forget
**Purpose**: Delete or archive memories with audit trail.

**Usage**:
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
  reason: "User requested data removal"
})

// Batch delete
memory_forget({
  ids: ["mem_1", "mem_2", "mem_3"],
  reason: "Project concluded"
})
```

**Parameters**:
- `id` (optional): Single memory ID to forget
- `ids` (optional): Array of memory IDs for batch deletion
- `hard_delete` (optional): true = permanent, false = soft delete (default: false)
- `reason` (optional): Stored in provenance for audit trail

**Soft vs Hard Delete**:
- **Soft**: Sets `is_deleted = true`, preserves all data for audit trail
- **Hard**: Permanently removes from database

---

## Usage Patterns

### Pattern 1: Discovery → Detail Loading
```typescript
// Step 1: Discover what exists
const result = memory_recall({
  query: "Python",
  max_tokens: 500  // Conservative budget
})

// Step 2: Review index (all matches)
result.index.forEach(mem => {
  console.log(`${mem.id}: ${mem.summary}`)
})

// Step 3: Get full details for specific memory if needed
const detailed = memory_recall({
  query: result.index[3].summary,  // Target specific memory
  limit: 1,
  max_tokens: 500
})
```

### Pattern 2: Hot Context Awareness
```typescript
// High-priority recent memories automatically surface in top results
const recentImportant = memory_recall({
  query: "current project",
  max_tokens: 1500
})

// Scoring formula prioritizes:
// - Recent access (30%)
// - High importance (40%)
// - Access frequency (30%)
```

### Pattern 3: Layered Information Architecture
```typescript
// Layer 1: What do I know? (minimal tokens)
const overview = memory_recall({
  query: "user preferences",
  max_tokens: 300
})
// Returns: index with 10-15 summaries

// Layer 2: Key details (moderate tokens)
const standard = memory_recall({
  query: "user preferences",
  max_tokens: 1500
})
// Returns: index + 5-7 full memories

// Layer 3: Comprehensive context (max tokens)
const comprehensive = memory_recall({
  query: "user preferences",
  max_tokens: 5000
})
// Returns: index + 20+ full memories
```

### Pattern 4: Entity-Based Filtering
```typescript
// Find all memories related to specific entities
const pythonMemories = memory_recall({
  query: "programming",
  entities: ["Python", "FastAPI"],
  max_tokens: 2000
})
```

### Pattern 5: Type-Based Organization
```typescript
// Facts only
const facts = memory_recall({
  query: "API design",
  type: "fact",
  max_tokens: 1000
})

// Relationships only
const relationships = memory_recall({
  query: "team structure",
  type: "relationship",
  max_tokens: 1000
})
```

---

## Token Economics

### Memory Footprint
| Component | Tokens | Notes |
|-----------|--------|-------|
| Summary (index) | ~20 | 20-word auto-generated |
| Full memory (details) | ~200 | Content + metadata |
| Provenance data | ~50 | Creation/update history |

### Response Size Comparison
| Scenario | Old v2.0 | New v3.0 | Savings |
|----------|----------|----------|---------|
| 10 matches, minimal | 300 tokens | 200 tokens | 33% |
| 10 matches, standard | 2000 tokens | 850 tokens | 57% |
| 50 matches, index only | N/A | 1000 tokens | New capability |

### Budgeting Guidelines
- **Quick lookup**: 300-500 tokens (index + 1-2 details)
- **Standard search**: 1000-1500 tokens (index + 5-7 details)
- **Deep dive**: 3000-5000 tokens (index + 15-25 details)

---

## Search Technology

**SQLite FTS5** (Full-Text Search):
- Porter stemming (automatic word variants)
- Unicode normalization
- Automatic index synchronization via triggers
- Zero external dependencies
- ~96% size reduction vs vector embeddings

**Hybrid Scoring Algorithm**:
```
final_score = (fts_rank × 0.4) + (importance × 0.3) + (recency × 0.2) + (frequency × 0.1)
```

**Search Features**:
- Automatic query normalization
- Phrase matching support
- Entity-based filtering
- Type-based filtering
- Importance thresholds

---

## Best Practices

### DO
✅ Start with conservative `max_tokens` budgets (500-1000)
✅ Review `index` to understand what exists before drilling down
✅ Use entity filters to narrow search scope
✅ Set appropriate `importance` scores when storing critical information
✅ Include descriptive `tags` for better organization
✅ Use soft delete by default to maintain audit trail

### DON'T
❌ Set `max_tokens` unnecessarily high (wastes context)
❌ Ignore the `index` field (it's designed for discovery)
❌ Over-tag memories (diminishing returns)
❌ Hard delete unless required (loses provenance)
❌ Store duplicate information (use update instead)

---

## Architecture Notes

### Automatic Features
- **Summary Generation**: Every memory gets a 20-word summary on creation
- **Entity Extraction**: Pattern-based NER extracts key entities automatically
- **Importance Scoring**: Heuristic-based scoring (0-10 scale)
- **TTL Management**: Importance × base_ttl formula with auto-refresh on access
- **Hot Context Tracking**: Automatic scoring based on access patterns
- **FTS5 Indexing**: Automatic synchronization via database triggers

### Database Schema
- **memories table**: Core memory storage
- **memories_fts**: FTS5 virtual table (auto-synced)
- **entities table**: Extracted entity references
- **provenance table**: Complete audit trail
- **schema_version**: Migration tracking

### Performance Characteristics
- **Search latency**: <10ms for most queries (FTS5)
- **Index size**: ~5% of content size (FTS5)
- **Memory overhead**: Minimal (SQLite in-process)
- **Concurrent access**: SQLite WAL mode support

---

## Troubleshooting

### "No results found"
- Check query spelling/phrasing
- Try broader search terms
- Remove entity/type filters
- Verify memories exist with generic query

### "Token budget exhausted"
- Increase `max_tokens` parameter
- Reduce `limit` to focus on top results
- Use entity/type filters to narrow scope

### "Importance seems wrong"
- Manual override: set `importance` explicitly when storing
- Scoring is heuristic-based, not perfect
- Critical memories: set importance 8-10

---

## Version History

**v3.0** (Current):
- Dual-response pattern (index + details)
- Token-aware budgeting via `max_tokens`
- SQLite FTS5 (replaced vector embeddings)
- 50% token reduction vs v2.0
- 3 tools (simplified from 6)

**v2.0** (Deprecated):
- Vector embeddings with @xenova/transformers
- 6 tools (separate create/update/hot_context)
- Fixed detail levels (minimal/standard/full)
- 86MB bundle size

**v1.x** (Historical):
- Python implementation
- Different architecture
