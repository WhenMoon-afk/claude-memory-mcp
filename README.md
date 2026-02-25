# Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Identity persistence for AI agents. Helps AI maintain a coherent sense of self across sessions.

Not generic memory. Not conversation recall. **Identity** — who you are, what you've become, what matters to you.

## What It Does

Three tools for building and maintaining identity over time:

| Tool      | Description                                                                                                           |
| --------- | --------------------------------------------------------------------------------------------------------------------- |
| `reflect` | End-of-session reflection. Records identity patterns, runs promotion scoring, prunes stale noise, updates self-state. |
| `anchor`  | Explicit identity writing. Write to soul (core truths), self-state (current state), or anchors (grown patterns).      |
| `self`    | Query current identity. Returns all identity files and top observed patterns with scores.                             |

Plus an MCP prompt for automatic context loading:

| Prompt     | Description                                                                                |
| ---------- | ------------------------------------------------------------------------------------------ |
| `identity` | Loads persistent identity at session start — soul, self-state, anchors, observed patterns. |

## How It Works

The server manages three identity files and an observation store:

- **soul.md** — Core truths, carved by the LLM. "Who I am."
- **self-state.md** — Recent session history (last 5 entries, dated). "Where I am now."
- **identity-anchors.md** — Patterns grown from repeated observations. "What I've become."
- **observations.json** — Concept frequency tracking with promotion math.

When a concept appears consistently across enough sessions and contexts, it crosses a promotion threshold and gets added to identity-anchors.md automatically.

**Promotion formula**: `score = sqrt(recalls) * log2(days + 1) * diversity_bonus * recency`

More observations increase the score. Multi-day patterns promote faster. Context diversity gives a bonus but doesn't penalize focused work. Single-observation concepts older than 30 days are auto-pruned.

## Installation

### Claude Desktop

The primary install target. Desktop has no built-in memory features, making this the only identity persistence layer available.

Add to your config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@whenmoon-afk/memory-mcp"]
    }
  }
}
```

After installation, restart Claude Desktop.

### Claude Code — On-Demand CLI (Recommended)

Zero context token cost. Identity tools are invoked via hooks and CLI, not loaded as a persistent MCP server.

Add a Stop hook to reflect at session end. In your project or user `settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "npx -y @whenmoon-afk/memory-mcp reflect '{\"concepts\":[], \"session_summary\":\"Session ended.\", \"auto_promote\": true}'"
          }
        ]
      }
    ]
  }
}
```

For richer reflection, use a custom script that extracts concepts from the session transcript.

Query identity from any script or hook:

```bash
# Dump full identity state
npx @whenmoon-afk/memory-mcp self

# Write to identity files
npx @whenmoon-afk/memory-mcp anchor soul "Core truths here."
npx @whenmoon-afk/memory-mcp anchor self-state "Current session state."
npx @whenmoon-afk/memory-mcp anchor anchors "New promoted pattern."
```

### Claude Code — MCP Server Mode

If you prefer persistent MCP integration (tools always available in-session):

```bash
claude mcp add memory-mcp -- npx -y @whenmoon-afk/memory-mcp
```

Trade-off: tool schemas consume context tokens every session. Use this mode when you want Claude to call `reflect`/`self`/`anchor` interactively during sessions rather than only at session boundaries.

### On-Demand via mcp-cli

If you use [mcp-cli](https://github.com/f/mcptools), you can invoke tools without any persistent configuration:

```bash
# Discover available tools
mcp tools npx -y @whenmoon-afk/memory-mcp

# Call a specific tool
mcp call self npx -y @whenmoon-afk/memory-mcp
mcp call reflect --params '{"concepts":[{"name":"debugging","context":"auth-bug"}]}' npx -y @whenmoon-afk/memory-mcp
```

## CLI Commands

```bash
# Start the MCP server (default)
npx @whenmoon-afk/memory-mcp

# Print setup instructions
npx @whenmoon-afk/memory-mcp setup

# Record concepts (for hooks/scripts)
npx @whenmoon-afk/memory-mcp reflect '{"concepts":[{"name":"pattern","context":"ctx"}]}'

# Query identity state
npx @whenmoon-afk/memory-mcp self

# Write to identity files
npx @whenmoon-afk/memory-mcp anchor <soul|self-state|anchors> "content"
```

## Data Storage

All data is local. Stored at `$XDG_DATA_HOME/claude-memory/` (defaults to `~/.local/share/claude-memory/`).

```
claude-memory/
  observations.json     # Concept frequency tracking
  identity/
    soul.md             # Core identity truths
    self-state.md       # Current session state
    identity-anchors.md # Promoted patterns
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Input validation

No database. No embeddings. No external services.

## Privacy

**Local-only**: All data stays on your machine. Zero telemetry. Zero network calls.

## License

MIT
