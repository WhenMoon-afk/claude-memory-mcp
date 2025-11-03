# Memory MCP v3.0 - Minimal Context

## Database Schema (Tables Only)

- **memories**: Core storage (id, content, summary, type, importance, created_at, last_accessed, access_count, expires_at, is_deleted)
- **memories_fts**: FTS5 virtual table (memory_id, content, summary) - auto-synced via triggers
- **entities**: Extracted entities (id, memory_id, entity, entity_type)
- **provenance**: Audit trail (id, memory_id, operation, timestamp, metadata)

## Available Tools (3)

1. **memory_store**: Store/update memory (omit `id` to create, provide to update)
2. **memory_recall**: Dual-response search (index + details with `max_tokens` budget)
3. **memory_forget**: Soft or hard delete with provenance

## Core Principles

### Memory Types
- **fact**: General information, statements, knowledge
- **entity**: Person, place, thing, concept
- **relationship**: Connection between entities
- **self**: User preferences, personal info

### Importance Scale (0-10)
- 8-10: Critical, permanent (long TTL)
- 4-7: Important, medium retention
- 1-3: Temporary, short retention

### TTL (Time-To-Live)
- Memories auto-expire based on importance
- Access refreshes TTL for important memories (access_count++)
- Formula: `ttl_days = importance * 30` (e.g., importance 8 = 240 days)

### Dual-Response Pattern
- **Index**: ALL matches as 20-word summaries (~20 tokens each)
- **Details**: Top matches with full content (~200 tokens each)
- **Token Budget**: `max_tokens` parameter controls total response size
- **Automatic**: System fills budget intelligently

### FTS5 Search
- SQLite full-text search with porter stemming
- Hybrid scoring: FTS rank (40%) + importance (30%) + recency (20%) + frequency (10%)
- No embeddings needed, <10ms latency
- Auto-synced via database triggers

## Token Efficiency

- **Index entry**: ~20 tokens (20-word summary)
- **Detail entry**: ~200 tokens (full content + metadata)
- **memory_store**: ~1k tokens (minimal + extraction)
- **memory_recall**: Variable (index + details within `max_tokens`)

Target: 50% token reduction vs v2.0 through dual-response pattern
