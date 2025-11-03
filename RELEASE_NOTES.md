# Memory MCP v2.0 - MCPB Bundle Release Notes

## Overview

Memory MCP v2.0 is now available as an official MCPB (Model Context Protocol Bundle) for one-click installation in Claude Desktop and other MCP clients.

## What's New in v2.0

### Complete TypeScript Rewrite
- Migrated from Python to TypeScript with ES modules
- Strict TypeScript configuration for maximum type safety
- Cross-platform compatibility (Windows, macOS, Linux)

### MCPB Bundle Support
- **Official MCPB v0.3 compliant manifest**
- One-click installation in Claude Desktop
- Bundled dependencies (no npm install required)
- GUI-based configuration
- Automatic updates via GitHub releases

### Smart Context Loading (93% Token Savings)
- **Progressive context loading** based on operation type
- Only 1k-6k tokens per operation vs 50k naive approach
- Four context modules: minimal, extraction, scoring, search
- Context loaded on-demand based on tool usage

### Brain-Inspired Memory System
- **6 MCP Tools**: store, recall, hot_context, update, forget, prune
- **Semantic search** with local embeddings (no API required)
- **Importance-based retention** with auto-calculated scores (0-10 scale)
- **TTL management** with auto-refresh on access
- **Full provenance tracking** for audit trails
- **Entity extraction** with auto-classification

### Local-First Architecture
- **No network access required** - 100% local processing
- **Local embeddings** using @xenova/transformers
- **SQLite database** for persistent storage
- Choice of 3 embedding models (MiniLM, MPNet, DistilRoBERTa)

### Companion Skill
- **3000+ line skill document** teaching Claude optimal memory usage
- Performance optimization techniques
- Troubleshooting guides
- Best practices and workflows

## Bundle Details

### File Size
- **Initial bundle**: 113MB
- **After cleaning**: 86MB (23% reduction)
- Includes all production dependencies

### Manifest Specifications
- **Manifest version**: MCPB v0.3
- **Bundle name**: memory-mcp
- **Version**: 2.0.0
- **Compatibility**: Claude Desktop >=0.10.0, Node >=18.0.0
- **Platforms**: darwin (macOS), win32 (Windows), linux

### User Configuration
The bundle provides 5 configurable parameters:

1. **databasePath** (string)
   - Default: `${HOME}/.memory-mcp/memory.db`
   - Path to SQLite database file

2. **embeddingModel** (string)
   - Default: `Xenova/all-MiniLM-L6-v2`
   - Options: MiniLM (fast), MPNet (balanced), DistilRoBERTa (quality)

3. **defaultTTLDays** (number)
   - Default: 90 days
   - Range: 1-3650 days
   - Time-to-live for memories

4. **hotContextLimit** (number)
   - Default: 20 items
   - Range: 5-100 items
   - Maximum hot context size

5. **enableAutoCapture** (boolean)
   - Default: true
   - Automatically extract facts from conversations

## Installation

### Prerequisites
- Claude Desktop (version >=0.10.0)
- Node.js >=18.0.0 (bundled with Claude Desktop)

### Install from Bundle
1. Download `claude-memory-mcp.mcpb` from GitHub releases
2. Open Claude Desktop settings
3. Navigate to MCP section
4. Click "Install Bundle"
5. Select the downloaded `.mcpb` file
6. Configure your preferences
7. Restart Claude Desktop

### Verify Installation
Open Claude Desktop and check:
- Memory MCP appears in installed extensions
- All 6 tools are available: `memory_store`, `memory_recall`, `get_hot_context`, `memory_update`, `memory_forget`, `prune_expired`
- Database is created at configured location

## Building from Source

If you want to build the bundle yourself:

```bash
# Clone the repository
git clone https://github.com/whenmoon-afk/claude-memory-mcp.git
cd claude-memory-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Install MCPB CLI
npm install -g @anthropic-ai/mcpb

# Create bundle
mcpb pack

# Clean and optimize
mcpb clean claude-memory-mcp.mcpb
```

Result: `claude-memory-mcp.mcpb` (~86MB)

## Architecture Highlights

### Database Schema
- **memories** table: Core memory storage with embeddings
- **entities** table: Extracted entities with metadata
- **memory_entities** junction: Many-to-many relationships
- **provenance** table: Full audit trail

### Semantic Search
- **Hybrid ranking**: Semantic similarity + importance + recency
- **Weighted scoring**: 50% semantic, 25% importance, 15% recency
- **Local embeddings**: 384d or 768d vectors
- **Cosine similarity** for semantic matching

### Memory Types
1. **Facts**: General information and knowledge
2. **Entities**: People, places, things with attributes
3. **Relationships**: Connections between entities

### Importance Scoring
Automatic calculation based on:
- Content analysis (keywords, patterns)
- Entity count and complexity
- Provenance information
- User-provided metadata

### TTL Management
- **Dynamic TTL**: Based on importance (7-365 days)
- **Auto-refresh**: TTL extends on access
- **Decay curves**: Natural forgetting simulation
- **Permanent storage**: Critical memories (TTL=null)

## Performance

### Token Efficiency
- **get_hot_context**: ~1k tokens (minimal context only)
- **memory_store**: ~6k tokens (minimal + extraction + scoring)
- **memory_recall**: ~5k tokens (minimal + search)
- **Naive approach**: ~50k tokens (loading everything)
- **Savings**: 93% token reduction

### Semantic Search Speed
- **Embedding generation**: ~10-50ms per query
- **Similarity calculation**: O(n) where n = candidate memories
- **Typical query**: <200ms for 1000 memories
- **Local processing**: No API latency

### Database Performance
- **SQLite**: Fast local storage
- **Indexed queries**: Optimized for common patterns
- **Batch operations**: Efficient bulk inserts
- **Memory-mapped I/O**: Fast reads

## Security & Privacy

### Data Protection
- **100% local**: No data leaves your machine
- **No API calls**: No external dependencies
- **User control**: You own your data
- **Transparent**: Full audit trail via provenance

### Permissions
- **Filesystem**: Read/write database file only
- **Network**: No network access
- **Sensitive data**: None required

## Migration from v1.x

Memory MCP v2.0 is a complete rewrite with a new database schema. To migrate:

1. Export memories from v1.x (if applicable)
2. Install v2.0 bundle
3. Import memories using `memory_store` tool
4. Verify with `memory_recall`

**Note**: v1.x used Python and a different schema. Direct database migration is not supported.

## Known Limitations

1. **Bundle size**: 86MB (includes all dependencies)
2. **Embedding models**: Limited to 3 pre-configured options
3. **No cloud sync**: Database is local-only
4. **No compression**: Embeddings stored as full vectors
5. **Language**: English-optimized (works with others but not tuned)

## Future Enhancements

### Planned for v2.1
- [ ] Compressed embeddings (reduce database size by 50%)
- [ ] Custom embedding model support
- [ ] Memory export/import utilities
- [ ] Database vacuum and optimization tools
- [ ] Multi-language support

### Under Consideration
- [ ] Memory clustering and visualization
- [ ] Automatic memory consolidation
- [ ] Cross-device sync (opt-in)
- [ ] Memory sharing between users
- [ ] Integration with external knowledge bases

## Support & Feedback

### Getting Help
- **Documentation**: https://github.com/whenmoon-afk/claude-memory-mcp#readme
- **MCPB Guide**: See MCPB.md in repository
- **Issues**: https://github.com/whenmoon-afk/claude-memory-mcp/issues

### Contributing
We welcome contributions! See CONTRIBUTING.md for guidelines.

### License
MIT License - See LICENSE file for details

## Acknowledgments

- **MCP SDK**: @modelcontextprotocol/sdk
- **Embeddings**: @xenova/transformers (Hugging Face)
- **Database**: better-sqlite3
- **MCPB CLI**: @anthropic-ai/mcpb
- **Inspiration**: Human memory systems and cognitive science

## Version History

### v2.0.0 (2025-01-XX)
- Complete TypeScript rewrite
- MCPB bundle support
- Smart context loading (93% token savings)
- 6 MCP tools with full functionality
- Local semantic search
- Companion skill document
- Cross-platform support

### v1.x (Previous)
- Python implementation
- Basic memory storage
- Limited search capabilities

---

**Download**: [claude-memory-mcp.mcpb](https://github.com/whenmoon-afk/claude-memory-mcp/releases/latest)

**Release Date**: January 2025

**Maintained by**: Memory MCP Contributors
