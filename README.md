# Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local, persistent memory for Claude Desktop and MCP-compatible AI assistants.

> *Part of the [Substratia](https://substratia.io) memory infrastructure ecosystem.*

A lightweight MCP server that gives your AI durable, searchable memory — entirely on your machine. Built with TypeScript, SQLite + FTS5, and minimal dependencies.

## Quick Start

Choose your installation method below based on your platform and preference.

### Option 1: Direct from GitHub (Always Latest)

This method fetches directly from GitHub, bypassing npm cache issues.

**macOS / Linux:**

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `~/.config/Claude/claude_desktop_config.json` on Linux):

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "github:whenmoon-afk/claude-memory-mcp"]
    }
  }
}
```

**Windows (Command Prompt wrapper):**

Add to your Claude Desktop config (`%APPDATA%/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "memory": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:whenmoon-afk/claude-memory-mcp"]
    }
  }
}
```

**Windows (Full npx.cmd path - alternative):**

```json
{
  "mcpServers": {
    "memory": {
      "command": "C:\\Program Files\\nodejs\\npx.cmd",
      "args": ["-y", "github:whenmoon-afk/claude-memory-mcp"]
    }
  }
}
```

**WSL Users:** Use the macOS/Linux config above.

### Option 2: Global Install (Most Reliable)

Install globally for offline support and faster startup:

```bash
npm install -g @whenmoon-afk/memory-mcp
```

Find your global npm path:
```bash
npm root -g
```

Then add to Claude Desktop config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "node",
      "args": ["YOUR_GLOBAL_PATH/node_modules/@whenmoon-afk/memory-mcp/dist/index.js"]
    }
  }
}
```

Replace `YOUR_GLOBAL_PATH` with the output from `npm root -g`.

### Option 3: Automatic Installer

For first-time setup, the installer configures Claude Desktop automatically:

```bash
npx @whenmoon-afk/memory-mcp-install
```

After any installation method, **restart Claude Desktop completely** (quit and reopen).

## Custom Database Location

By default, memories are stored at `~/.memory-mcp/memory.db` on all platforms.

To use a custom location, add the `env` field to your config:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "github:whenmoon-afk/claude-memory-mcp"],
      "env": {
        "MEMORY_DB_PATH": "/path/to/your/memory.db"
      }
    }
  }
}
```

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

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MEMORY_DB_PATH` | Platform-specific | Database file location |
| `DEFAULT_TTL_DAYS` | `90` | Default memory expiration |

## Troubleshooting

### Tools not appearing in Claude Desktop?

1. Restart Claude Desktop completely (quit and reopen)
2. Verify config file syntax is valid JSON
3. Check that Node.js 18+ is installed: `node --version`

### "Connection closed" on Windows?

Windows requires either:
- The `cmd /c` wrapper method (see Windows config above), OR
- The full path to `npx.cmd` (e.g., `C:\Program Files\nodejs\npx.cmd`)

### Getting stale cached versions?

The `npx github:` method bypasses npm cache. Alternatively:
- Clear npm cache: `npm cache clean --force`
- Use global install for version control

### Slow startup with github: method?

First run requires downloading and installing dependencies (can take 30+ seconds). Subsequent runs are faster but still fetch from GitHub. For faster startup, use the global install method.

## Dependencies

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `better-sqlite3` - Fast native SQLite with FTS5

## Links

- **npm**: https://www.npmjs.com/package/@whenmoon-afk/memory-mcp
- **GitHub**: https://github.com/WhenMoon-afk/claude-memory-mcp
- **Issues**: https://github.com/WhenMoon-afk/claude-memory-mcp/issues

## Want Cloud Sync?

**[Substratia Pro](https://substratia.io)** (coming soon) adds:
- Cloud sync across all your devices
- Memory dashboard to view/edit what AI remembers
- Automatic backups and disaster recovery
- Team memory sharing

**[Join the waitlist](https://substratia.io)** to get early access.

## Related Projects

Part of the **Substratia** memory infrastructure ecosystem:

- **[momentum](https://github.com/WhenMoon-afk/momentum)** - Instant context recovery (<5ms) for Claude Code
- **[AgentForge](https://substratia.io/builder)** - Visual drag-and-drop agent config builder
- **[Substratia](https://substratia.io)** - Memory infrastructure for AI

## Support

- [GitHub Issues](https://github.com/WhenMoon-afk/claude-memory-mcp/issues) - Bug reports & feature requests
- [GitHub Sponsors](https://github.com/sponsors/WhenMoon-afk) - Support development
- [Ko-fi](https://ko-fi.com/substratia) - One-time contributions

## Disclaimer

This project is provided as-is. It is actively maintained but may have breaking changes between minor versions.

## License

MIT
