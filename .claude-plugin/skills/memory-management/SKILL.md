---
name: memory-management
description: Use when starting tasks to recall relevant context, or when completing work that should be remembered
---

# Memory Management

Persistent memory for Claude Code. Remember decisions, preferences, and learnings across sessions.

## When to Use Memory

### Recall Memory (start of tasks)
Search for relevant context when:
- Starting work on a familiar project
- User references past decisions ("we decided...", "last time...")
- Facing a problem you may have solved before
- Needing project-specific preferences or patterns

### Store Memory (end of tasks)
Save important learnings when:
- Making architectural decisions
- Discovering user preferences
- Solving tricky debugging issues
- Learning project-specific patterns
- Establishing workflow conventions

## MCP Tools

### memory_recall
Search memories by query. Returns relevant past context.

```
memory_recall query:"authentication approach"
memory_recall query:"user preferences" type:"preference"
```

**Parameters:**
- `query` (required): What to search for
- `type`: Filter by memory type (decision, preference, learning, pattern, etc.)
- `entities`: Filter by related entities
- `limit`: Max results (default 20, max 50)
- `max_tokens`: Token budget for response (default 1000)

### memory_store
Store new memory for future recall.

```
memory_store content:"User prefers Tailwind CSS over styled-components for this project"
memory_store content:"Auth uses JWT tokens with 24h expiry, stored in httpOnly cookies" type:"decision"
```

**Parameters:**
- `content` (required): What to remember
- `type`: Memory type (auto-detected if not provided)
- `importance`: 1-10 scale (auto-calculated if not provided)
- `entities`: Related entities (auto-extracted if not provided)
- `tags`: Additional categorization

### memory_forget
Remove a memory by ID (soft delete).

```
memory_forget id:"mem_abc123" reason:"Outdated after refactor"
```

## Memory Types

| Type | Use For |
|------|---------|
| `decision` | Architectural choices, tech stack decisions |
| `preference` | User/project preferences, conventions |
| `learning` | Debugging solutions, discovered patterns |
| `pattern` | Code patterns, project-specific idioms |
| `fact` | Factual information, configurations |

## Cloud Sync (Optional)

Memories sync to Substratia Cloud for backup and cross-device access.

To connect: `memory_cloud action:connect api_key:YOUR_KEY`

Get your API key at https://substratia.io/dashboard
