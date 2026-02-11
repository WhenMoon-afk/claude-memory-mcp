---
name: memory-management
description: Store and recall memories across Claude Code sessions. Cures AI amnesia - remember decisions, preferences, and learnings.
---

# Memory Management

**Core principle:** Store valuable learnings. Recall relevant context. Build institutional knowledge across sessions.

## MCP Tools

### memory_store

Store a memory for future recall.

```
memory_store(
  content: string,         # What to remember
  type?: "fact" | "entity" | "relationship" | "self",  # Auto-classified if omitted
  id?: string,             # Provide to update existing memory
  importance?: 0-10,       # Auto-calculated if not provided
  entities?: string[],     # Auto-extracted if not provided
  tags?: string[],         # For categorization
  metadata?: object,       # Additional metadata
  ttl_days?: number,       # Time-to-live in days
  expires_at?: string,     # Explicit expiration (ISO format)
  provenance?: object      # Source, timestamp, context, user_id
)
```

**When to store:**

- User preferences ("I prefer tabs over spaces")
- Project decisions ("We chose PostgreSQL for X reason")
- Architecture patterns ("Auth flow uses JWT with refresh tokens")
- Lessons learned ("Don't use library X, it has issue Y")
- Entity relationships ("User manages Project, Project has Tasks")

### memory_recall

Search and retrieve relevant memories.

```
memory_recall(
  query: string,         # What to search for
  max_tokens?: number,   # Token budget (default: 1000, range: 100-5000)
  type?: "fact" | "entity" | "relationship" | "self",  # Filter by memory type
  entities?: string[],   # Filter by related entities
  limit?: number         # Max results (default: 20, max: 50)
)
```

**When to recall:**

- Starting work on a project (recall project context)
- Making decisions (recall past decisions and rationale)
- User asks "remember when..." or "what did we decide about..."
- Before suggesting solutions (recall past learnings)

### memory_forget

Remove a memory (soft delete with provenance).

```
memory_forget(
  id: string,            # Memory ID to forget
  reason?: string        # Reason for forgetting (stored in provenance)
)
```

## Best Practices

1. **Be selective** - Store valuable, reusable knowledge, not ephemeral details
2. **Use appropriate importance** - 8+ for critical decisions, 5-7 for useful info
3. **Add context** - Include WHY something matters, not just WHAT
4. **Recall proactively** - Check for relevant context before making suggestions
5. **Update over time** - Store corrections when past memories become outdated

## Memory Types

| Type           | Use For                                   |
| -------------- | ----------------------------------------- |
| `fact`         | General knowledge, decisions, preferences |
| `entity`       | People, projects, systems, tools          |
| `relationship` | How entities connect (X depends on Y)     |
| `self`         | User-specific preferences and patterns    |
