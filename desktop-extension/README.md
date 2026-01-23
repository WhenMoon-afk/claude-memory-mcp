# Memory MCP - Claude Desktop Extension

Persistent memory for Claude Desktop. Remember decisions, preferences, and learnings across sessions.

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

| Setting | Description |
|---------|-------------|
| `database_path` | Custom database location (optional) |
| `cloud_api_key` | Substratia Cloud API key for sync |
| `default_ttl_days` | Memory expiration in days |

API keys are stored securely in your OS keychain.

## Usage

The extension provides these tools to Claude:

- **memory_recall** - Search past memories
- **memory_store** - Save new memories
- **memory_forget** - Remove memories
- **memory_cloud** - Manage cloud sync

Claude will automatically use these tools when relevant context is needed or worth saving.

## Cloud Sync (Optional)

Enable cloud backup and cross-device access:

1. Create account at https://substratia.io
2. Get API key from dashboard
3. Enter key in extension settings

Free tier: 100 memories
Pro ($9/month): Unlimited memories + dashboard

## Building from Source

```bash
npm install
npm run build
npm run package:desktop
```

## License

MIT - See LICENSE file
