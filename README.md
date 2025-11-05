# claude-memory-mcp

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

Local, persistent memory for AI agents via Model Context Protocol (MCP). Zero-cloud, token-efficient, stored in a single portable SQLite database.

**Stack:** TypeScript + SQLite FTS5 | **Runtime Deps:** MCP SDK + better-sqlite3
**Clients:** Claude Desktop, Cursor, Windsurf, any MCP client

---

## Features

- **Dual-Response Pattern:** Index (all matches) + details (budget-capped) in one query
- **Token Budgeting:** Auto-allocates ~30% index, ~70% details within `max_tokens`
- **Smart Scoring:** 40% relevance, 30% importance, 20% recency, 10% frequency
- **Auto-Summarization:** ≤20-word summaries for fast scanning
- **Entity Extraction:** People, tools, concepts, preferences
- **FTS5 Search:** Sub-10ms, Unicode, stemming, no embeddings
- **Provenance:** Full audit trail with timestamps
- **Soft Deletes:** Non-destructive, recoverable
- **Portable:** Single `memory.db` file

---

## Installation

**Requirements:** Node.js ≥ 18, MCP-compatible client

**Auto-install (recommended):**
```bash
npx @whenmoon-afk/memory-mcp
```
Detects your OS, configures Claude Desktop, creates config backup. Then restart Claude Desktop.

**Global install:**
```bash
npm install -g @whenmoon-afk/memory-mcp
memory-mcp
```

**From source:**
```bash
git clone https://github.com/WhenMoon-afk/claude-memory-mcp.git
cd claude-memory-mcp
npm install && npm run build
```

### Manual Configuration

Config paths:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**NPM install (macOS/Linux):**
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@whenmoon-afk/memory-mcp"],
      "env": {"MEMORY_DB_PATH": "./memory.db"}
    }
  }
}
```

**NPM install (Windows - requires `cmd /c`):**
```json
{
  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@whenmoon-afk/memory-mcp"],
      "env": {"MEMORY_DB_PATH": "./memory.db"}
    }
  }
}
```

**Global/source:** Replace `command` with `memory-mcp` or `node`, adjust `args` accordingly.

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

## Configuration

**Environment Variables:**
- `MEMORY_DB_PATH` (default: `./memory.db`) - Database file location
- `DEFAULT_TTL_DAYS` (default: `90`) - Memory expiration in days

**Database:** Single portable `memory.db` SQLite file. Copy/backup/sync freely.

**Security:** Local-only server, plain SQLite storage. Use OS-level encryption (FileVault, BitLocker) for sensitive data.

---

## Best Practices

- Start with `max_tokens: 1000`, adjust per model/task
- Filter by `type` to reduce noise
- Use entity filtering for specific topics
- Backup `memory.db` regularly

---

## Links

- [NPM Package](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
- [GitHub](https://github.com/WhenMoon-afk/claude-memory-mcp)
- [Issues](https://github.com/WhenMoon-afk/claude-memory-mcp/issues)
- [MCP Docs](https://modelcontextprotocol.io)

## License

MIT - Copyright (c) 2025 WhenMoon-afk
