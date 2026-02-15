# Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Local, persistent memory for Claude Desktop and MCP-compatible AI assistants.

> _Part of the [Substratia](https://substratia.io) memory infrastructure ecosystem._

A lightweight MCP server that gives your AI durable, searchable memory — entirely on your machine. Built with TypeScript, SQLite + FTS5, and minimal dependencies.

## Quick Start

### Claude Desktop

Download `memory-mcp.mcpb` from [GitHub Releases](https://github.com/whenmoon-afk/claude-memory-mcp/releases) and double-click to install.

### Claude Code

```bash
claude plugin install github:whenmoon-afk/claude-memory-mcp
```

<details>
<summary><strong>Alternative: Manual JSON Config</strong></summary>

Add to your Claude Desktop config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%/Claude/claude_desktop_config.json`

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

Windows may need `"command": "cmd", "args": ["/c", "npx", "-y", "github:whenmoon-afk/claude-memory-mcp"]`

</details>

After installation, **restart Claude Desktop** (quit and reopen).

## Tools

| Tool            | Description                                                  |
| --------------- | ------------------------------------------------------------ |
| `memory_store`  | Store a memory with auto-summarization and entity extraction |
| `memory_recall` | Search memories with token-aware loading                     |
| `memory_forget` | Soft-delete a memory (preserves audit trail)                 |

## Features

- FTS5 full-text search (fast, no embeddings needed)
- Token budgeting for context-aware responses
- Automatic entity extraction and summarization
- Soft deletes with provenance tracking
- Hybrid relevance scoring (recency + importance + frequency)

## Environment Variables

| Variable           | Default           | Description               |
| ------------------ | ----------------- | ------------------------- |
| `MEMORY_DB_PATH`   | Platform-specific | Database file location    |
| `DEFAULT_TTL_DAYS` | `90`              | Default memory expiration |

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
- `zod` - Runtime input validation

## Links

- **npm**: https://www.npmjs.com/package/@whenmoon-afk/memory-mcp
- **GitHub**: https://github.com/WhenMoon-afk/claude-memory-mcp
- **Issues**: https://github.com/WhenMoon-afk/claude-memory-mcp/issues

## Related Projects

Part of the **Substratia** memory infrastructure ecosystem:

- **[momentum](https://github.com/WhenMoon-afk/momentum)** - Instant context recovery (<5ms) for Claude Code
- **[AgentForge](https://substratia.io/builder)** - Visual drag-and-drop agent config builder
- **[Substratia](https://substratia.io)** - Memory infrastructure for AI

## Support

- [GitHub Issues](https://github.com/WhenMoon-afk/claude-memory-mcp/issues) - Bug reports & feature requests

## Privacy

**Local-only**: All memories are stored locally on your machine. No data is sent anywhere. Zero telemetry.

## Disclaimer

This project is provided as-is. It is actively maintained but may have breaking changes between minor versions.

## License

MIT
