# Memory MCP v3.0 - Scoring Context

> **v3.0 Note**: Hot context scoring is now integrated into memory_recall's hybrid scoring algorithm (40% FTS rank, 30% importance, 20% recency, 10% frequency). No separate tool needed.

## Importance Scoring (0-10)

### Importance Tiers

**Critical (8-10)**
- User identity and core preferences
- Security credentials and API keys
- Project requirements and constraints
- Core system facts and limitations
- Permanent relationships (family, core team)

**Important (5-7)**
- Work preferences and patterns
- Active project context
- Technical knowledge and patterns
- Professional relationships
- Domain expertise and facts

**Useful (3-4)**
- Temporary context and notes
- One-time interactions
- Nice-to-know information
- Peripheral relationships

**Ephemeral (1-2)**
- Session-specific context
- Transient states
- Exploratory information
- Low-value facts

### Auto-Scoring Formula

```typescript
base_score = 3  // Default baseline

// Content analysis factors (+0 to +3)
+ contentComplexity    // 0-1: Simple statement vs detailed info
+ entityCount * 0.5    // More entities = more connections
+ isUserPreference ? 2 : 0  // User prefs are important

// Context factors (+0 to +2)
+ hasProvenance ? 0.5 : 0   // Tracked sources are more reliable
+ hasMetadata ? 0.5 : 0     // Rich metadata adds value
+ isExplicit ? 1 : 0        // Explicit facts > implicit

// Type-based adjustments (+0 to +2)
+ (type === 'relationship') ? 1 : 0  // Relationships connect knowledge
+ (type === 'entity' && isPerson) ? 1 : 0  // People are important

// Final importance = clamp(base_score, 0, 10)
```

### Manual Override Rules

**Always use manual importance for:**
- Security-critical information (importance: 10)
- User explicitly says "remember this" (importance: 8-9)
- Corrections to previous memories (importance: +1 from original)
- Deprecated information (importance: 1-2, short TTL)

## TTL (Time-To-Live) Management

### Default TTL by Importance

| Importance | Default TTL | Rationale |
|------------|-------------|-----------|
| 10 | Permanent (null) | Never expires |
| 8-9 | 365 days | Core facts, reviewed yearly |
| 6-7 | 180 days | Important context, reviewed bi-annually |
| 4-5 | 90 days | Useful info, reviewed quarterly |
| 2-3 | 30 days | Temporary context, reviewed monthly |
| 1 | 7 days | Ephemeral, reviewed weekly |

### TTL Refresh on Access

When a memory is accessed (read), its TTL is potentially refreshed based on importance:

```typescript
function refreshTTL(memory) {
  const daysSinceAccess = now() - memory.last_accessed;
  const accessBonus = (memory.importance / 10) * 30; // 0-30 days

  if (memory.importance >= 6 && daysSinceAccess > 7) {
    // Important memories: refresh TTL
    memory.expires_at = now() + memory.original_ttl + accessBonus;
  } else if (memory.importance >= 4 && daysSinceAccess > 30) {
    // Moderately important: refresh after longer gap
    memory.expires_at = now() + memory.original_ttl + (accessBonus / 2);
  }
  // Low importance (1-3): No refresh, let it expire

  memory.last_accessed = now();
}
```

### TTL Override Scenarios

**Permanent (ttl_days: null)**
- User identity and core preferences
- Foundational system knowledge
- Critical relationships
- Never-changing facts

**Extended (ttl_days: 365+)**
- Project requirements (may change annually)
- Team structure (reviewed yearly)
- Technology standards (evolve slowly)

**Short-lived (ttl_days: 1-14)**
- Session context
- Temporary experiments
- In-progress work states
- Quick notes

**Manual refresh required**
- Security-sensitive information (explicit refresh only)
- Deprecated facts (expire quickly, no auto-refresh)
- Conflicting information (new supersedes old)

## Decay and Forgetting

### Natural Decay Curve

Importance decays over time for unaccessed memories:

```typescript
function calculateDecay(memory) {
  const daysSinceAccess = now() - memory.last_accessed;
  const decayRate = 0.01; // 1% per day without access

  if (memory.importance < 6) {
    // Low-importance memories decay faster
    const decayFactor = 1 - (daysSinceAccess * decayRate * 2);
    memory.effective_importance = memory.importance * Math.max(decayFactor, 0.5);
  } else {
    // High-importance memories resist decay
    const decayFactor = 1 - (daysSinceAccess * decayRate * 0.5);
    memory.effective_importance = memory.importance * Math.max(decayFactor, 0.8);
  }
}
```

### Forgetting Triggers

**Automatic (system-initiated):**
- TTL expires
- Importance decayed below threshold (effective < 1)
- Superseded by newer memory
- Marked as incorrect

**Manual (user-initiated):**
- User requests deletion
- Privacy concern raised
- Information no longer relevant
- Explicit forget command

**Soft vs Hard Delete:**
- Soft: Mark as deleted, preserve provenance (default)
- Hard: Permanent removal via memory_forget with hard_delete=true

## Hot Context Scoring

Hot context prioritizes recent + important:

```typescript
function hotScore(memory) {
  const recencyScore = calculateRecency(memory.last_accessed); // 0-5
  const importanceScore = memory.importance / 2; // 0-5

  // Weighted combination
  return (recencyScore * 0.4) + (importanceScore * 0.6);
}

function calculateRecency(lastAccessed) {
  const hoursAgo = (now() - lastAccessed) / (1000 * 60 * 60);

  if (hoursAgo < 1) return 5;      // Very recent
  if (hoursAgo < 6) return 4;      // Recent
  if (hoursAgo < 24) return 3;     // Today
  if (hoursAgo < 168) return 2;    // This week
  if (hoursAgo < 720) return 1;    // This month
  return 0;                         // Older
}
```

Hot context returns top N memories by hot score.

## Importance Adjustment Patterns

### Boost Importance When:
- Memory accessed frequently (3+ times in short period)
- User explicitly references it ("as I mentioned...")
- Connected to many other memories (high centrality)
- Part of active project context

### Reduce Importance When:
- Never accessed after initial storage
- Contradicted by newer information
- Project/context no longer active
- User indicates it's less relevant

### Re-evaluation Triggers:
- Every 30 days for importance ≥ 6
- Every 60 days for importance 4-5
- Every 90 days for importance 1-3
- On access (check if adjustment needed)

## Best Practices

### DO:
✅ Use auto-scoring for most memories
✅ Override for user preferences (8-9) and security (10)
✅ Set appropriate TTL based on information lifespan
✅ Let important memories refresh on access
✅ Review and adjust importance periodically

### DON'T:
❌ Over-score everything (dilutes importance)
❌ Use permanent TTL for temporal information
❌ Ignore decay signals (repeated non-access)
❌ Skip TTL for any memory (always set a default)
❌ Hard-delete without reviewing (use soft delete first)

## Scoring Decision Tree

```
Is this user identity or core preference?
├─ YES → importance: 9-10, ttl: null
└─ NO → Continue

Is this security-sensitive or critical?
├─ YES → importance: 9-10, ttl: 365+
└─ NO → Continue

Is this project requirement or key context?
├─ YES → importance: 7-8, ttl: 180-365
└─ NO → Continue

Is this useful information or relationship?
├─ YES → importance: 5-6, ttl: 90-180
└─ NO → Continue

Is this temporary or exploratory?
├─ YES → importance: 3-4, ttl: 30-90
└─ NO → importance: 1-2, ttl: 7-30
```
