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
  content: string,       # What to remember
  type?: "fact" | "entity" | "relationship" | "self",
  importance?: 0-10,     # 8+ = critical, 5-7 = high, 3-4 = normal
  tags?: string[],       # For categorization
  context?: string       # Additional context
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
  type?: string,         # Filter by memory type
  limit?: number,        # Max results (default 10)
  token_budget?: number  # Max tokens to return
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
memory_forget(id: string)
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
