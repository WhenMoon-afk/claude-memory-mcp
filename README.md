# claude-memory-mcp

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

**Local, Persistent Memory for Any MCP-Compatible AI**
A lightweight, **zero-cloud**, **token-efficient** Model Context Protocol (MCP) server that gives your AI **durable, searchable, and context-aware memory** - entirely under your control.

Built with **TypeScript**, **SQLite + FTS5**, and **minimal runtime dependencies** (MCP SDK + better-sqlite3), it runs locally and stores everything in a single, portable `.db` file.

Works with **Claude Desktop**, **Cursor**, **Windsurf**, or any MCP client.

📦 **Now available on npm**: Install with `npx @whenmoon-afk/memory-mcp`

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
- An **MCP-compatible client** (Claude Desktop, Cursor, Windsurf, etc.)

### Option 1: NPM Package with Auto-Setup (Recommended)

**Automatic installation** (configures Claude Desktop for you):
```bash
npx @whenmoon-afk/memory-mcp
```

This will automatically:
- Detect your operating system (macOS/Windows/Linux)
- Add the memory server to your Claude Desktop configuration
- Create a backup of your existing config
- Configure the correct command format for your platform

After installation, **restart Claude Desktop completely** (quit and reopen).

**Or install globally**:
```bash
npm install -g @whenmoon-afk/memory-mcp
memory-mcp
```

### Option 2: From Source

For development or customization:
```bash
git clone https://github.com/WhenMoon-afk/claude-memory-mcp.git
cd claude-memory-mcp
npm install
npm run build
```

> Output: `dist/index.js` — your memory server.

---

### Claude Code Installation

For users of Claude Code (terminal-based Claude), use the `claude mcp add` command:

**Global Memory (user-wide, persists across all projects):**
```bash
claude mcp add memory -s user -- npx -y @whenmoon-afk/memory-mcp
```

**Per-Project Memory (project-specific, stored in project directory):**
```bash
claude mcp add memory -s local -e MEMORY_DB_PATH=./memory.db -- npx -y @whenmoon-afk/memory-mcp
```

**Verify installation:**
```bash
claude mcp list
```

> **Tip:** Use `--scope user` for personal knowledge that spans projects. Use `--scope local` with `MEMORY_DB_PATH=./memory.db` for codebase-specific context that stays with the repository.

---

## Docker Deployment

Run the Memory MCP server in a containerized environment with persistent storage.

### Prerequisites
- Docker installed ([Get Docker](https://docs.docker.com/get-docker/))
- Docker Compose (included with Docker Desktop)

### Quick Start with Docker Compose

**1. Clone the repository:**
```bash
git clone https://github.com/WhenMoon-afk/claude-memory-mcp.git
cd claude-memory-mcp
```

**2. Start the container:**
```bash
docker-compose up -d
```

This will:
- Build the Docker image with Node.js 20
- Create a persistent volume at `./data/` for the database
- Start the MCP server in detached mode

**3. View logs:**
```bash
docker-compose logs -f memory-mcp
```

**4. Stop the container:**
```bash
docker-compose down
```

### Manual Docker Build

**Build the image:**
```bash
docker build -t memory-mcp:latest .
```

**Run the container:**
```bash
# Create data directory
mkdir -p ./data

# Run container with volume mount
docker run -d \
  --name memory-mcp \
  -v "$(pwd)/data:/data" \
  -e MEMORY_DB_PATH=/data/memory.db \
  -e DEFAULT_TTL_DAYS=90 \
  memory-mcp:latest
```

**Interact with the running container:**
```bash
# View logs
docker logs -f memory-mcp

# Execute commands inside container
docker exec -it memory-mcp /bin/bash

# Stop container
docker stop memory-mcp

# Remove container
docker rm memory-mcp
```

### Volume Persistence

The database is stored in a Docker volume mapped to `./data/` on your host:

| Location | Path |
|----------|------|
| **Host** | `./data/memory.db` |
| **Container** | `/data/memory.db` |

**To backup your database:**
```bash
cp ./data/memory.db ./memory-backup-$(date +%Y%m%d).db
```

**To restore from backup:**
```bash
cp ./memory-backup-20250105.db ./data/memory.db
docker-compose restart
```

### Environment Variables (Docker)

Configure via `docker-compose.yml` or `-e` flags:

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DB_PATH` | `/data/memory.db` | Database file location inside container |
| `DEFAULT_TTL_DAYS` | `90` | Default memory expiration (days) |
| `MEMORY_DB_DRIVER` | `better-sqlite3` | Database driver (better-sqlite3 or sqljs) |
| `NODE_ENV` | `production` | Node environment |

### Docker Notes

- **No HTTP Port**: This is a stdio-based MCP server. Communication happens via stdin/stdout, not HTTP requests.
- **Native Dependencies**: Uses multi-stage build to compile better-sqlite3 native bindings
- **Resource Limits**: Default docker-compose.yml sets 512MB memory limit (adjustable)
- **Auto-restart**: Container restarts automatically unless explicitly stopped

### Using with MCP Clients

When running in Docker, you'll need to configure your MCP client to communicate with the containerized server. The exact method depends on your client:

- **For local development**: Use `docker exec` to run commands
- **For production**: Consider using a container orchestration platform (Kubernetes, ECS, etc.)

> **Tip**: For most use cases, the **NPM package installation** (Option 1) is simpler and more suitable than Docker, since MCP servers typically run locally and communicate directly with the AI client via stdio.

---

## Integrate with Your MCP Client

Add to your client's MCP config file:

**Claude Desktop**:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Cursor/Windsurf**: Check your editor's MCP settings

> **💡 Recommended**: Use the automatic installer (`npx @whenmoon-afk/memory-mcp`) which handles platform differences automatically.

### Manual Configuration (macOS/Linux)
```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@whenmoon-afk/memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "./memory.db"
      }
    }
  }
}
```

### Manual Configuration (Windows)

**Windows requires the `cmd /c` wrapper** to execute npx properly:

```json
{
  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@whenmoon-afk/memory-mcp"],
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

## Dependencies

This project uses minimal runtime dependencies to keep the package lightweight:

| Dependency | Version | Purpose |
|-----------|---------|---------|
| `@modelcontextprotocol/sdk` | ^1.0.4 | Official MCP protocol implementation |
| `better-sqlite3` | ^11.0.0 | Fast, native SQLite3 bindings with FTS5 support |

**Why these dependencies?**
- **MCP SDK**: Required for implementing the Model Context Protocol standard
- **better-sqlite3**: Native performance for full-text search and database operations, essential for memory recall speed

All other dependencies are dev-only (TypeScript, testing, linting).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DB_PATH` | Platform-specific* | Database file location |
| `MEMORY_DB_DRIVER` | `better-sqlite3` | Database driver (`better-sqlite3` or `sqljs`) |
| `DEFAULT_TTL_DAYS` | `90` | Default time-to-live for memories (days) |

*Default database locations (when installed via `npx`):
- **macOS:** `~/.claude-memories/memory.db`
- **Windows:** `%APPDATA%\claude-memories\memory.db`
- **Linux:** `~/.local/share/claude-memories/memory.db`

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

---

## Quick Links

- 📦 **NPM Package**: https://www.npmjs.com/package/@whenmoon-afk/memory-mcp
- 🐙 **GitHub Repository**: https://github.com/WhenMoon-afk/claude-memory-mcp
- 🐛 **Report Issues**: https://github.com/WhenMoon-afk/claude-memory-mcp/issues
- 📖 **MCP Documentation**: https://modelcontextprotocol.io

---

## Contributing

Contributions are welcome! Feel free to:
- Report bugs or request features via [GitHub Issues](https://github.com/WhenMoon-afk/claude-memory-mcp/issues)
- Submit pull requests for improvements
- Share your use cases and feedback

---

## License

MIT License - see [LICENSE](LICENSE) file for details.

**Copyright (c) 2025 WhenMoon-afk**

---

**Built with ❤️ for the MCP community**
