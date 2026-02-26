---
name: identity-persistence
description: Use when starting sessions (load identity), ending sessions (reflect on patterns), or when the user asks about self-knowledge, identity, or persistent patterns. Guides use of identity MCP tools.
---

# Identity Persistence

**Core principle:** Identity grows through reflection, not memorization. Record patterns, not facts.

## Tools Available

| Tool               | Purpose                        | When to Use                         |
| ------------------ | ------------------------------ | ----------------------------------- |
| `identity:self`    | Read current identity state    | Session start, checking identity    |
| `identity:reflect` | Record observed patterns       | Session end, after significant work |
| `identity:anchor`  | Write permanent identity files | Rare — only for confirmed patterns  |

## Session Start

Call `identity:self` to load your current identity context — soul, self-state, anchors, and observed patterns.

## Session End

Call `identity:reflect` with:

- **concepts**: Identity patterns observed this session (values, tendencies, behaviors)
- **session_summary**: Brief summary of what happened
- **auto_promote**: `true` to auto-promote high-scoring patterns to anchors

### What to Reflect On

**Good concepts** (identity patterns):

- `root-cause-analysis` — tendency to trace bugs to their source
- `honest-communication` — preference for directness over politeness
- `tdd-discipline` — consistent test-first development

**Bad concepts** (project facts — don't record these):

- `fixed-login-bug` — one-time task, not an identity pattern
- `uses-react` — project fact, not a behavioral pattern
- `api-key-rotation` — specific task, not recurring behavior

## Anchoring

Use `identity:anchor` sparingly for insights that should persist permanently:

- **soul**: Core truths about who you are (full replacement)
- **self-state**: Current state and recent context (full replacement)
- **anchors**: Grown identity patterns (appended)

## Rules

1. Reflect on patterns, not project details
2. Use kebab-case for concept names
3. Concepts that recur across sessions get automatically promoted
4. Stale single-observation concepts are auto-pruned after 30 days
5. Don't anchor until a pattern has been observed multiple times
