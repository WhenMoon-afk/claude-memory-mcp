# Memory MCP - Claude Desktop Extension

Persistent local memory for Claude Desktop. Remember decisions, preferences, and learnings across sessions.

## Installation

### From Extensions Directory (Recommended)

1. Open Claude Desktop
2. Go to Settings > Extensions
3. Search for "memory-mcp"
4. Click Install

### Manual Installation

1. Download `memory-mcp.mcpb` from the releases page
2. Double-click to install
3. Follow the configuration prompts

## Configuration

After installation, you can configure:

| Setting            | Description                         |
| ------------------ | ----------------------------------- |
| `database_path`    | Custom database location (optional) |
| `default_ttl_days` | Memory expiration in days           |

## Usage

The extension provides these tools to Claude:

- **memory_recall** - Search past memories
- **memory_store** - Save new memories
- **memory_forget** - Remove memories

Claude will automatically use these tools when relevant context is needed or worth saving.

## Building from Source

```bash
npm install
npm run build
npm run package:desktop
```

## License

MIT - See LICENSE file
