# Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local, persistent memory for Claude Desktop and MCP-compatible AI assistants.

A lightweight MCP server that gives your AI durable, searchable memory — entirely on your machine. Built with TypeScript, SQLite + FTS5, and minimal dependencies.

## Installation

Requires Node.js 18+

Run this command to automatically configure Claude Desktop:

```bash
npx @whenmoon-afk/memory-mcp
```

This will:
- Detect your OS (macOS/Windows/Linux)
- Configure Claude Desktop with the memory server
- Create backup of existing config
- Set up platform-appropriate database location

After installation, restart Claude Desktop completely.

## Database Location

Memories are stored locally:

- **macOS**: `~/.claude-memories/memory.db`
- **Windows**: `%APPDATA%/claude-memories/memory.db`
- **Linux**: `~/.local/share/claude-memories/memory.db`

The database is a single portable SQLite file. Back it up by copying the file.

## Tools

| Tool | Description |
|------|-------------|
| `memory_store` | Store a memory with auto-summarization and entity extraction |
| `memory_recall` | Search memories with token-aware loading |
| `memory_forget` | Soft-delete a memory (preserves audit trail) |

## Features

- FTS5 full-text search (fast, no embeddings needed)
- Token budgeting for context-aware responses
- Automatic entity extraction and summarization
- Soft deletes with provenance tracking
- Hybrid relevance scoring (recency + importance + frequency)

## Manual Configuration

If auto-setup doesn't work, add to your Claude Desktop config:

**Config locations:**
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add this to your config (the installer does this automatically):

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["/path/to/node_modules/@whenmoon-afk/memory-mcp/dist/index.js"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/.claude-memories/memory.db"
      }
    }
  }
}
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DB_PATH` | Platform-specific | Database file location |
| `DEFAULT_TTL_DAYS` | `90` | Default memory expiration |

## Troubleshooting

**Tools not appearing in Claude Desktop?**

1. Restart Claude Desktop completely (quit and reopen)
2. Verify config file syntax is valid JSON
3. Check that Node.js 18+ is installed: `node --version`
4. Re-run installer: `npx @whenmoon-afk/memory-mcp`

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `better-sqlite3` - Fast native SQLite with FTS5

## Links

- **npm**: https://www.npmjs.com/package/@whenmoon-afk/memory-mcp
- **GitHub**: https://github.com/WhenMoon-afk/claude-memory-mcp
- **Issues**: https://github.com/WhenMoon-afk/claude-memory-mcp/issues

## License

MIT
