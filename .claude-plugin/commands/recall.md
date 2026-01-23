---
name: recall
description: Search your persistent memory for past decisions, learnings, and preferences
arguments:
  - name: query
    description: What to search for
    required: true
---

# Memory Recall

Search your persistent memory for relevant context.

Use the `memory_recall` MCP tool with the provided query to search for past decisions, preferences, learnings, and patterns.

Return results in a concise format showing:
1. Most relevant memories with their content
2. When they were created
3. Related entities if any

If no memories found, suggest what types of information the user might want to store for future sessions.
