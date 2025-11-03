# Memory MCP v3.0 - Search Context

## SQLite FTS5 Full-Text Search

v3.0 uses SQLite FTS5 (Full-Text Search) instead of vector embeddings.

**Benefits:**
- Zero external dependencies (built into SQLite)
- ~96% size reduction vs v2.0 embeddings
- <10ms search latency
- Automatic index synchronization
- Porter stemming for word variants
- Unicode normalization

## FTS5 Configuration

```sql
CREATE VIRTUAL TABLE memories_fts USING fts5(
  memory_id UNINDEXED,  -- Not searchable, just stored
  content,              -- Searchable content
  summary,              -- Searchable summary
  tokenize = 'porter unicode61'
);
```

**Tokenizers:**
- `porter`: Porter stemming algorithm (run → running → runner)
- `unicode61`: Unicode normalization (handles accents, case folding)

**Auto-Sync Triggers:**
- INSERT → Add to FTS
- UPDATE content/summary → Update FTS
- UPDATE is_deleted=1 → Remove from FTS
- UPDATE is_deleted=0 → Add back to FTS

## Search Algorithm

### Step 1: FTS5 Query

```typescript
// Search both content and summary
const ftsQuery = db.prepare(`
  SELECT
    memory_id,
    bm25(memories_fts) AS fts_rank
  FROM memories_fts
  WHERE memories_fts MATCH ?
  ORDER BY fts_rank
`).all(normalizedQuery);
```

**BM25 Ranking:**
- Industry-standard ranking algorithm
- Accounts for term frequency and document length
- Returns negative scores (lower = better match)

### Step 2: Load Full Memory Data

```typescript
// Load complete memory data for FTS matches
const memories = ftsQuery.map(ftsResult => {
  return db.prepare(`
    SELECT * FROM memories WHERE id = ?
  `).get(ftsResult.memory_id);
});
```

### Step 3: Hybrid Scoring

Combine FTS rank with metadata signals:

```typescript
function hybridScore(memory, ftsRank) {
  // Normalize FTS rank to 0-1 range
  const maxRank = -50; // Typical max BM25 score
  const normalizedFTS = Math.max(0, 1 + (ftsRank / maxRank));

  // Normalize other signals to 0-1
  const importanceScore = memory.importance / 10;
  const recencyScore = calculateRecency(memory.last_accessed);
  const frequencyScore = normalizeFrequency(memory.access_count);

  // Weighted combination
  return (
    normalizedFTS * 0.4 +      // 40% FTS relevance
    importanceScore * 0.3 +    // 30% importance
    recencyScore * 0.2 +       // 20% recency
    frequencyScore * 0.1       // 10% frequency
  );
}
```

**Recency Calculation:**
```typescript
function calculateRecency(lastAccessed: number): number {
  const now = Date.now();
  const ageMs = now - lastAccessed;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: recent = 1.0, 30 days = 0.5, 90 days = 0.25
  return Math.exp(-ageDays / 30);
}
```

**Frequency Normalization:**
```typescript
function normalizeFrequency(accessCount: number): number {
  // Logarithmic scale: 1 access = 0.0, 10 = 0.5, 100 = 1.0
  return Math.log10(accessCount + 1) / 2;
}
```

### Step 4: Apply Filters

```typescript
// Post-filter by user criteria
let filtered = scored;

if (options.type) {
  filtered = filtered.filter(m => m.type === options.type);
}

if (options.entities) {
  filtered = filtered.filter(m =>
    options.entities.some(e => m.entities.includes(e))
  );
}

if (options.minImportance) {
  filtered = filtered.filter(m => m.importance >= options.minImportance);
}

if (!options.includeExpired) {
  const now = Date.now();
  filtered = filtered.filter(m =>
    m.expires_at === null || m.expires_at > now
  );
}
```

### Step 5: Sort and Limit

```typescript
// Sort by hybrid score (descending)
filtered.sort((a, b) => b.hybridScore - a.hybridScore);

// Apply limit and offset
const total = filtered.length;
const results = filtered.slice(
  options.offset || 0,
  (options.offset || 0) + (options.limit || 20)
);

return { results, totalCount: total };
```

## Query Normalization

### Text Normalization

```typescript
function normalizeTextForSearch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')  // Remove special chars
    .replace(/\s+/g, ' ');       // Collapse whitespace
}
```

### Query Syntax

FTS5 supports special syntax:

```typescript
// Phrase search
"exact phrase"

// AND operator (default)
term1 term2

// OR operator
term1 OR term2

// NOT operator
term1 NOT term2

// Prefix search
term*

// Column-specific search
{content}: term
{summary}: term
```

**Example queries:**
```typescript
// Search for "typescript" in content only
memory_recall({ query: '{content}: typescript' })

// Search for exact phrase
memory_recall({ query: '"coding preferences"' })

// Search with OR
memory_recall({ query: 'python OR javascript' })

// Prefix search
memory_recall({ query: 'program*' })  // Matches: program, programming, programmer
```

## Performance Optimization

### Index Maintenance

```sql
-- Rebuild FTS index (if needed)
INSERT INTO memories_fts(memories_fts) VALUES('rebuild');

-- Optimize FTS index (merge segments)
INSERT INTO memories_fts(memories_fts) VALUES('optimize');
```

### Query Performance

**Fast:**
- Simple term searches: `typescript`
- Phrase searches: `"coding style"`
- Prefix searches: `program*`

**Slow:**
- Wildcard suffix: `*gram` (not supported)
- Complex boolean: `(term1 OR term2) AND NOT (term3 OR term4)`
- Very long queries: >100 terms

**Best Practices:**
- Keep queries simple and focused
- Use filters (type, entities) to reduce result set
- Set appropriate limits (10-20 typical)
- Avoid unnecessary wildcards

## Dual-Response Pattern

### Index Generation

```typescript
// Always return ALL matches as minimal summaries
const index: MinimalMemory[] = results.map(memory => ({
  id: memory.id,
  summary: memory.summary  // Pre-generated 20-word summary
}));
```

**Cost:** ~20 tokens per memory

### Details Generation

```typescript
// Fill remaining token budget with full content
const details: FormattedMemory[] = [];
let tokensUsed = estimateTokens(index);

for (const memory of results) {
  const formatted = formatMemory(memory, 'standard');
  const memoryTokens = getMemoryTokenCount(formatted);

  if (tokensUsed + memoryTokens <= maxTokens) {
    details.push(formatted);
    tokensUsed += memoryTokens;
  } else {
    break;  // Budget exhausted
  }
}
```

**Cost:** ~200 tokens per memory (standard format)

### Response Structure

```typescript
{
  index: MinimalMemory[];        // ALL matches (always)
  details: FormattedMemory[];    // Top matches within budget
  total_count: number;
  has_more: boolean;
  tokens_used: number;
  query: string;
}
```

## Entity-Based Search

### Entity Filtering

```typescript
// Find memories mentioning specific entities
const pythonMemories = await semanticSearch(db, {
  query: 'programming',
  entities: ['Python', 'FastAPI'],  // Must mention these entities
  limit: 20
});
```

**Implementation:**
```typescript
// Join with entities table
SELECT m.*
FROM memories m
JOIN entities e ON e.memory_id = m.id
WHERE e.entity IN (?, ?)
  AND m.id IN (SELECT memory_id FROM memories_fts WHERE ...)
```

### Entity Extraction

Auto-extracted during `memory_store`:

```typescript
// Pattern-based extraction
const entities = extractEntities(content);
// ["Python", "TypeScript", "React", "API", ...]

// Store in entities table
for (const entity of entities) {
  db.prepare(`
    INSERT INTO entities (id, memory_id, entity)
    VALUES (?, ?, ?)
  `).run(generateId(), memoryId, entity);
}
```

## Type-Based Search

### Type Filtering

```typescript
// Facts only
memory_recall({ query: 'API', type: 'fact' })

// Entities only
memory_recall({ query: 'team', type: 'entity' })

// Relationships only
memory_recall({ query: 'project', type: 'relationship' })

// Self (user preferences)
memory_recall({ query: 'coding', type: 'self' })
```

**Implementation:**
```sql
SELECT * FROM memories
WHERE type = ?
  AND id IN (SELECT memory_id FROM memories_fts WHERE ...)
```

## Search Quality Tips

### For Best Results

✅ **Use natural language:** "What are the user's coding preferences?"
✅ **Be specific:** "Python FastAPI patterns" not just "programming"
✅ **Use exact phrases:** "dark mode preference"
✅ **Include context:** "frontend project requirements"
✅ **Leverage entities:** Filter by specific entity names

### Query Examples

**Good:**
```typescript
// Specific, natural language
memory_recall({ query: 'Python coding style preferences' })

// Entity-focused
memory_recall({
  query: 'projects',
  entities: ['FastAPI', 'React']
})

// Type-filtered
memory_recall({
  query: 'team structure',
  type: 'relationship'
})
```

**Poor:**
```typescript
// Too vague
memory_recall({ query: 'stuff' })

// Too complex boolean
memory_recall({ query: '(python OR javascript) AND NOT (deprecated OR old)' })

// Excessive wildcards
memory_recall({ query: 'program* develop* code*' })
```

## Performance Targets

- **FTS5 search**: <5ms for most queries
- **Hybrid scoring**: <5ms for <1000 results
- **Total search**: <10ms end-to-end
- **Index build**: <50ms for new memory
- **Index update**: <30ms for memory update

## Token Efficiency

- **Search context**: ~2k tokens (loaded only for memory_recall)
- **Index entry**: ~20 tokens (summary only)
- **Detail entry**: ~200 tokens (full content + metadata)
- **Response overhead**: ~50 tokens (structure, counts, query)

**Example:**
```typescript
memory_recall({ query: 'Python', max_tokens: 1000 })
// Returns:
// - Index: 20 matches × 20 tokens = 400 tokens
// - Details: 3 matches × 200 tokens = 600 tokens
// - Total: ~1000 tokens (within budget)
```

## Troubleshooting

### No Results Found

1. **Check query spelling:** FTS5 is case-insensitive but exact
2. **Try broader terms:** "code" instead of "coding_style_preferences"
3. **Remove filters:** Try without type/entity filters first
4. **Check expiration:** Use `includeExpired: true`

### Poor Quality Results

1. **Adjust hybrid weights:** Tune FTS/importance/recency ratios
2. **Update importance scores:** Critical memories should be 8-10
3. **Improve summaries:** Better summaries = better search
4. **Add entities:** Entity filtering improves precision

### Slow Performance

1. **Reduce limit:** 10-20 is optimal, avoid 50+
2. **Optimize index:** Run `INSERT INTO memories_fts(memories_fts) VALUES('optimize')`
3. **Simplify query:** Avoid complex boolean expressions
4. **Use filters:** type and entity filters reduce result set

## Comparison: FTS5 vs Embeddings

| Feature | FTS5 (v3.0) | Embeddings (v2.0) |
|---------|-------------|-------------------|
| Bundle size | ~3MB | ~86MB |
| Search latency | <10ms | ~100-250ms |
| Accuracy | Good (keyword) | Better (semantic) |
| Setup | Zero config | Model download |
| Memory | Minimal | 40-200MB |
| Offline | Yes | Yes |
| Dependencies | Built-in | @xenova/transformers |

**Trade-off:** FTS5 sacrifices some semantic understanding for massive size/speed improvements.

**Mitigation:** Hybrid scoring + entity extraction + good summaries compensate for simpler search.
