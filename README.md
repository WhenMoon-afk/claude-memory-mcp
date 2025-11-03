# claude-memory-mcp

**Local, Persistent Memory for Any MCP-Compatible AI**  
A lightweight, **zero-cloud**, **token-efficient** Model Context Protocol (MCP) server that gives your AI **durable, searchable, and context-aware memory** - entirely under your control.

Built with **TypeScript**, **SQLite + FTS5**, and **no external dependencies**, it runs locally and stores everything in a single, portable `.db` file.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, or any MCP client.

---

## Why Local Memory?

| You Control | Cloud Services |
|-----------|----------------|
| Data never leaves your machine | Sent to remote servers |
| Portable `.db` file | Locked in proprietary storage |
| Full audit & backup | Opaque retention policies |
| Zero recurring cost | Subscription required |

---

## Features

| Feature | Benefit |
|-------|--------|
| **Dual-Response Pattern** | Returns *all* matches (compact index) + full *details* within token budget |
| **Token Budgeting** | Auto-respects `max_tokens` (~30% index, ~70% details) |
| **Hybrid Relevance Scoring** | 40% relevance, 30% importance, 20% recency, 10% frequency |
| **Auto-Summarization** | Generates ≤20-word natural-language summaries |
| **Entity Extraction** | Detects people, tools, concepts, preferences |
| **FTS5 Full-Text Search** | Sub-10ms queries, Unicode, stemming — no embeddings |
| **Provenance Tracking** | Full audit trail: source, timestamp, updates |
| **Soft Deletes** | Memories preserved for debugging/rollback |
| **Single-File DB** | `memory.db` — copy, backup, move freely |

---

## Installation

### Prerequisites
- Node.js ≥ 18
- An **MCP-compatible client**

### Quick Install (NPM)
```bash
npx @whenmoon-afk/memory-mcp
```

Or install globally:
```bash
npm install -g @whenmoon-afk/memory-mcp
memory-mcp
```

### From Source
```bash
git clone https://github.com/WhenMoon-afk/claude-memory-mcp.git
cd claude-memory-mcp
npm install
npm run build
```

> Output: `dist/index.js` — your memory server.

---

## Integrate with Your MCP Client

Add to your client's MCP config:

### Using NPM Package (Recommended)
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["@whenmoon-afk/memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "./memory.db"
      }
    }
  }
}
```

### Using Global Install
```json
{
  "mcpServers": {
    "memory": {
      "command": "memory-mcp",
      "env": {
        "MEMORY_DB_PATH": "./memory.db"
      }
    }
  }
}
```

### From Source
```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/absolute/path/to/claude-memory-mcp/dist/index.js"],
      "env": {
        "MEMORY_DB_PATH": "./memory.db"
      }
    }
  }
}
```

> Restart or reload MCP servers.

---

## MCP Tools

| Tool | Input | Description |
|------|-------|-----------|
| `memory_store` | `{ content, type, importance?, entities?, ttl_days?, provenance? }` | Store or update memory with auto-summary |
| `memory_recall` | `{ query, type?, entities?, limit?, max_tokens? }` | Search memories with token-aware loading |
| `memory_forget` | `{ id, reason? }` | Soft-delete memory (preserves provenance) |

---

### Store a Preference

```json
{
  "tool": "memory_store",
  "input": {
    "content": "User works best in focused 90-minute blocks with 15-minute breaks.",
    "type": "fact",
    "importance": 8
  }
}
```

→ Auto-creates:
- Summary: `"User follows 90/15 focused work cycles."`
- Entities: `focused work`, `90-minute blocks`
- Provenance: current session

---

### Smart Recall (Dual-Response)

```json
{
  "tool": "memory_recall",
  "input": {
    "query": "work habits",
    "max_tokens": 1200
  }
}
```

**Response**:
```json
{
  "index": [
    { "id": "mem_8b1", "summary": "User follows 90/15 focused work cycles.", "score": 96 },
    { "id": "mem_2c9", "summary": "User avoids meetings before 10 AM.", "score": 88 }
  ],
  "details": [
    {
      "id": "mem_8b1",
      "content": "User works best in focused 90-minute blocks with 15-minute breaks.",
      "entities": ["focused work", "90-minute blocks"],
      "provenance": { "source": "chat_2025-11-03", "created_at": "2025-11-03T14:10Z" }
    }
  ],
  "meta": {
    "tokens_used": 698,
    "total_matches": 2,
    "truncated": false
  }
}
```

Your AI **knows what it knows** — and can ask for more.

---

### Forget a Memory

```json
{
  "tool": "memory_forget",
  "input": {
    "id": "mem_8b1",
    "reason": "Information no longer relevant"
  }
}
```

**Response**:
```json
{
  "success": true,
  "memory_id": "mem_8b1",
  "message": "Memory soft-deleted successfully. Reason: Information no longer relevant"
}
```

> Soft-deleted memories are **preserved** in the database with full provenance trail. They won't appear in searches but remain recoverable.

---

## Dual-Response Pattern

```
[index]   → All matching summaries (~20 tokens each)
[details] → Full content of top memories (budget-capped)
[meta]    → tokens_used, total_matches, truncated
```

- **Index**: Always included → *discovery*
- **Details**: Budget-safe → *precision*
- **Follow-up**: Use `ids: [...]` to expand

---

## Database & Portability

- **File**: `memory.db` (SQLite) — path via `MEMORY_DB_PATH`
- **Portable**: Copy to USB, cloud sync, or new machine
- **Backup**: Just copy the file
- **Tip**: For extra security, store `memory.db` on a **VeraCrypt Encrypted USB drive** (adds friction, but maximum control).

---

## Environment Variables

| Var | Default | Description |
|-----|---------|-----------|
| `MEMORY_DB_PATH` | `./memory.db` | Database file location |
| `DEFAULT_TTL_DAYS` | `90` | Default time-to-live for memories (days) |

---

### Security

This is a **local-only** MCP server.  
Data is stored in a plain SQLite file (`memory.db`).  
For sensitive data, use OS-level encryption (FileVault, BitLocker).

---

## Best Practices

1. **Start with `max_tokens: 1000`** — adjust per model and task.
2. **Filter by `type`** to reduce noise and improve relevance.
3. **Use entity filtering** to narrow searches to specific topics.
4. **Reference provenance**: Track source and context for audit trails.
5. **Backup `memory.db`** regularly — it's just a file!



