# MCPB Bundle Documentation

This document explains how Memory MCP v2.0 is structured as an MCP Bundle (MCPB) and how to build and distribute it.

## What is MCPB?

MCPB (Model Context Protocol Bundle) is a packaging format for MCP servers that enables:
- One-click installation in Claude Desktop and other MCP clients
- Self-contained distribution with bundled dependencies
- Automatic configuration through a standardized manifest
- Version management and automatic updates

MCPB files are zip archives containing:
- An MCP server implementation
- A `manifest.json` descriptor following the MCPB v0.3 specification
- Bundled dependencies (`node_modules/` for Node.js servers)
- Optional assets (icons, documentation)

## Project Structure

```
claude-memory-mcp/
├── src/               # TypeScript source code
├── dist/              # Compiled JavaScript (created by build)
│   ├── index.js       # Main server entry point
│   ├── skill/         # Companion skill documentation
│   └── contexts/      # Smart context loading modules
├── mcpb/              # MCPB bundle configuration
│   └── manifest.json  # MCPB v0.3 manifest
├── node_modules/      # Dependencies (bundled in .mcpb file)
└── package.json       # Node.js project configuration
```

## MCPB Manifest (v0.3)

Our `mcpb/manifest.json` follows the official MCPB v0.3 specification:

### Required Fields
- `manifest_version`: "0.3"
- `name`: "memory-mcp"
- `version`: "2.0.0" (semantic versioning)
- `description`: Brief description
- `author`: Object with `name` and optional `url`
- `server`: Configuration object

### Server Configuration
```json
{
  "server": {
    "type": "node",
    "entry_point": "dist/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/dist/index.js"],
      "env": {
        "MEMORY_DB_PATH": "${user_config.databasePath}",
        "EMBEDDING_MODEL": "${user_config.embeddingModel}",
        ...
      }
    }
  }
}
```

**Variable Substitution:**
- `${__dirname}`: Bundle installation directory
- `${user_config.fieldName}`: User-configured values
- `${HOME}`: User home directory

### User Configuration
The `user_config` section defines fields users can configure in Claude Desktop:
- `databasePath`: Where to store the SQLite database
- `embeddingModel`: Which embedding model to use
- `defaultTTLDays`: Default memory retention period
- `hotContextLimit`: Max items in hot context
- `enableAutoCapture`: Auto-extract facts from conversations

### Tools
All 6 MCP tools are statically declared with:
- `name`: Tool identifier
- `description`: What the tool does
- `inputSchema`: JSON Schema for parameters

Tools are also registered programmatically in `src/index.ts` using the MCP SDK.

### Compatibility
```json
{
  "compatibility": {
    "claude_desktop": ">=0.10.0",
    "platforms": ["darwin", "win32", "linux"],
    "runtimes": {
      "node": ">=18.0.0"
    }
  }
}
```

## Building the Bundle

### 0. Initialize Manifest (First Time Only)

If starting from scratch, use `mcpb init` to create a basic manifest:

```bash
mcpb init
```

This will interactively prompt for:
- Extension name
- Author information
- Version and description
- Server configuration (type, entry point)
- Tools (can be added later)
- User configuration fields
- Compatibility constraints

**Note:** For Memory MCP, we've already created a complete manifest with all 6 tools and user configuration.

### 1. Build TypeScript
```bash
npm run build
```

This compiles TypeScript to JavaScript in `dist/` and copies skill/context files.

### 2. Create MCPB Archive (Official CLI)

The `@anthropic-ai/mcpb` CLI tool is now available on npm:

```bash
# Install MCPB CLI globally
npm install -g @anthropic-ai/mcpb

# Pack the bundle
mcpb pack

# This creates: claude-memory-mcp.mcpb (~113MB)
```

### 3. Clean and Optimize the Bundle

The initial bundle includes dev dependencies. Clean it to reduce size:

```bash
# Clean the bundle (removes dev dependencies, unnecessary files)
mcpb clean claude-memory-mcp.mcpb

# Result: ~86MB (23% size reduction)
```

**Before Clean:** 113MB
**After Clean:** 86MB

The cleaned bundle only includes production dependencies and necessary files.

### 4. Verify the Bundle

```bash
# Display bundle information
mcpb info claude-memory-mcp.mcpb

# Validate manifest without packing
mcpb validate manifest.json

# Unpack to inspect contents (optional)
mcpb unpack claude-memory-mcp.mcpb ./unpacked
```

## Testing the Bundle

### Local Development
```bash
# Run in development mode
npm run dev

# Test with stdio (MCP protocol)
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node dist/index.js
```

### In Claude Desktop
1. Open Claude Desktop settings
2. Navigate to MCP section
3. Click "Install Bundle"
4. Select the `.mcpb` file
5. Configure user settings (database path, model, etc.)
6. Restart Claude Desktop

## MCP Server Implementation

The server (`src/index.ts`) follows MCP best practices:

### Stdio Transport
```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

All MCP communication happens over stdin/stdout. Logging uses stderr to avoid protocol interference.

### Tool Registration
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [...] };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Handle tool calls with proper error handling
});
```

### Error Handling
```typescript
try {
  // Tool logic
} catch (error) {
  if (error instanceof McpError) throw error;
  throw new McpError(ErrorCode.InternalError, message);
}
```

### Cleanup
```typescript
process.on('SIGINT', () => {
  closeDatabase();
  process.exit(0);
});
```

## Smart Context Loading

Memory MCP achieves 93% token savings through progressive context loading:

1. **Always loaded**: `dist/contexts/minimal.md` (1k tokens)
   - Core concepts, table structure, tool overview

2. **Loaded for memory_store**: `dist/contexts/extraction.md` (2k tokens)
   - Entity extraction patterns, classification rules

3. **Loaded for scoring**: `dist/contexts/scoring.md` (1k tokens)
   - Importance formula, TTL calculations

4. **Loaded for memory_recall**: `dist/contexts/search.md` (3k tokens)
   - Semantic search algorithm, ranking formula

The MCP SDK doesn't directly support context modules, so we reference them in `_meta` and expect clients to implement smart loading based on tool calls.

## Companion Skill

The companion skill at `dist/skill/SKILL.md` teaches Claude optimal memory usage patterns:
- When to use each tool
- How to formulate effective search queries
- Best practices for memory organization
- Performance optimization techniques
- Troubleshooting common issues

Reference in manifest's `_meta.skill` field for clients that support skill integration.

## Distribution

### GitHub Releases
1. Tag a new version: `git tag v2.0.0`
2. Push tags: `git push --tags`
3. Create GitHub release
4. Attach `.mcpb` file to release
5. Claude Desktop can auto-update from releases

### NPM Package (Alternative)
While MCPB bundles are preferred, you can also publish to npm:
```bash
npm publish
```

Users can then install with:
```bash
npm install -g @memory-mcp/server
```

But MCPB bundles provide a better user experience with:
- No manual npm installation
- Bundled dependencies
- GUI configuration
- Automatic updates

## Security Considerations

### Local-Only Processing
- No network access (`allowOutbound: false` in old manifest format)
- All embeddings generated locally using `@xenova/transformers`
- Database stored locally on user's machine

### Filesystem Access
The manifest declares required filesystem permissions:
- Read: Database file, context modules, skill documentation
- Write: Database file only

### Secrets Handling
User configuration fields marked as `"sensitive": true` are:
- Never logged
- Stored securely by Claude Desktop
- Passed only via environment variables

Currently, no sensitive fields are required, but this would be used for API keys if external services were added.

## Troubleshooting

### Bundle Won't Install
- Verify manifest.json is valid JSON
- Check `manifest_version` is "0.3"
- Ensure `server.entry_point` points to valid file
- Confirm all required fields are present

### Server Won't Start
- Check Node.js version >= 18.0.0
- Verify `node_modules/` is included in bundle
- Look for errors in Claude Desktop logs
- Test manually: `node dist/index.js`

### Tools Not Working
- Ensure database path is writable
- Check embedding model is downloading correctly
- Verify stdio communication (shouldn't see logs in stdout)
- Use stderr for debugging output

## Future Enhancements

When the MCPB CLI is officially released:
- Add `mcpb init` for scaffolding
- Use `mcpb validate` for manifest validation
- Implement `mcpb pack` for automated bundling
- Add `mcpb publish` for registry submission

## References

- [MCPB Specification](https://github.com/anthropics/mcpb)
- [MCPB Manifest v0.3](https://github.com/anthropics/mcpb/blob/main/MANIFEST.md)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Model Context Protocol](https://modelcontextprotocol.org)

## License

MIT License - See LICENSE file for details
