# Claude Memory MCP — Identity Persistence

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

### Claude Code — Plugin (Recommended)

Install via the Substratia marketplace for the best experience — MCP server, hooks, skills, and commands bundled together:

```
/plugin marketplace add whenmoon-afk/substratia-marketplace
/plugin install identity@substratia-marketplace
```

This gives you:

- **MCP server** — `identity:reflect`, `identity:anchor`, `identity:self` tools available in every session
- **SessionStart hook** — loads identity context automatically
- **Skills** — guides Claude on when and how to use identity tools
- **Commands** — `/reflect` and `/identity` slash commands

### Claude Desktop

The primary install target. Desktop has no built-in memory features, making this the only identity persistence layer available.

Add to your config file:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "identity": {
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
claude mcp add identity -- npx -y @whenmoon-afk/memory-mcp
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

## Examples

### Session-end reflection

**User prompt**: "We're done for today. I noticed you kept using root-cause analysis when debugging — please reflect on that."

**Tool call**: `reflect` with:

```json
{
  "concepts": [
    { "name": "root-cause-analysis", "context": "debugging auth module" },
    { "name": "systematic-approach", "context": "investigating API timeout" }
  ],
  "session_summary": "Debugged authentication failures and API timeouts. Applied systematic root-cause analysis throughout.",
  "auto_promote": true
}
```

**Output**: `Recorded 2 new concept(s).\n  root-cause-analysis: 1.0\n  systematic-approach: 1.0`

### Querying identity at session start

**User prompt**: "Load your identity context."

**Tool call**: `self` (no parameters)

**Output**: Returns current soul, self-state with recent session summaries, identity anchors (promoted patterns), and top observed patterns with scores.

### Writing a core identity truth

**User prompt**: "Add to your soul that you value honesty over performance."

**Tool call**: `anchor` with:

```json
{
  "target": "soul",
  "content": "# Soul\n\nI value honesty over performance. I'd rather say 'I don't know' than pretend."
}
```

**Output**: `Updated soul.md`

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

All data is local. Default locations by platform:

| Platform | Default Location                |
| -------- | ------------------------------- |
| Linux    | `~/.local/share/claude-memory/` |
| macOS    | `~/.local/share/claude-memory/` |
| Windows  | `%APPDATA%\claude-memory\`      |

Override with environment variables (checked in order):

1. `IDENTITY_DATA_DIR` — explicit path, used as-is
2. `XDG_DATA_HOME` — appends `/claude-memory`
3. `APPDATA` — appends `\claude-memory` (Windows)

```
claude-memory/
  observations.json     # Concept frequency tracking
  identity/
    soul.md             # Core identity truths
    self-state.md       # Recent session history
    identity-anchors.md # Promoted patterns
```

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — Input validation

No database. No embeddings. No external services.

## Privacy Policy

**Local-only**: All data stays on your machine.

- **Data collection**: None. The server collects no data from users.
- **Network calls**: None. The server makes zero network requests. All operations are local filesystem reads and writes.
- **Telemetry**: None. No analytics, no tracking, no crash reporting.
- **Data storage**: Identity files and observations are stored in a local directory on your machine (see [Data Storage](#data-storage) above). You control the location via environment variables.
- **Third-party sharing**: None. No data leaves your machine.
- **Data retention**: You control retention. Delete the data directory to remove all data. The `pruneStale()` function automatically removes single-observation concepts older than 30 days.

## Support

- **Issues**: [github.com/whenmoon-afk/claude-memory-mcp/issues](https://github.com/whenmoon-afk/claude-memory-mcp/issues)
- **Repository**: [github.com/whenmoon-afk/claude-memory-mcp](https://github.com/whenmoon-afk/claude-memory-mcp)

## License

MIT
