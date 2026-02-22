# Memory MCP

[![npm version](https://badge.fury.io/js/@whenmoon-afk%2Fmemory-mcp.svg)](https://www.npmjs.com/package/@whenmoon-afk/memory-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Identity persistence for AI agents. An MCP server that helps AI maintain a coherent sense of self across sessions.

## What It Does

Three tools that help an AI agent build and maintain identity over time:

| Tool      | Description                                                                                                                                                                            |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reflect` | End-of-session concept extraction. Records observed patterns, runs promotion scoring, optionally updates self-state. Set `auto_promote: true` to automatically anchor mature patterns. |
| `anchor`  | Explicit identity writing. Write to soul (core truths), self-state (current state), or anchors (grown patterns).                                                                       |
| `self`    | Query current identity. Returns all identity files and top observed patterns with scores.                                                                                              |

Plus an MCP prompt for automatic context loading:

| Prompt     | Description                                                                                |
| ---------- | ------------------------------------------------------------------------------------------ |
| `identity` | Loads persistent identity at session start — soul, self-state, anchors, observed patterns. |

## How It Works

The server manages three identity files and an observation store:

- **soul.md** — Core truths, carved by the LLM. "Who I am."
- **self-state.md** — Current state, updated each session. "Where I am now."
- **identity-anchors.md** — Patterns grown from repeated observations. "What I've become."
- **observations.json** — Concept frequency tracking with promotion math.

When a concept appears consistently across enough sessions and contexts, it crosses a promotion threshold and gets added to identity-anchors.md automatically.

**Promotion formula**: `score = total_recalls * log2(distinct_days + 1) * context_diversity * recency_weight`

## Quick Start

### Claude Code

```bash
claude mcp add memory-mcp -- npx -y @whenmoon-afk/memory-mcp
```

### Claude Desktop

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

### Auto-Reflect Hook (Claude Code)

Add a Stop hook to `.claude/settings.json` to automatically reflect at session end:

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

### CLI Commands

```bash
# Start the MCP server (default)
npx @whenmoon-afk/memory-mcp

# Print setup instructions
npx @whenmoon-afk/memory-mcp setup

# Record concepts from CLI (for hooks/scripts)
npx @whenmoon-afk/memory-mcp reflect '{"concepts":[{"name":"pattern","context":"ctx"}]}'
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
