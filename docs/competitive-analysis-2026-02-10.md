# Competitive Analysis: Memory MCP Server Landscape
*Generated 2026-02-10*

## Summary Table

| # | Name | Stars | Storage | Vector Search? | Key Differentiator |
|---|------|-------|---------|:-:|---|
| 1 | **Anthropic Official server-memory** | 44k npm/wk | JSONL | No | Default/reference, ubiquitous |
| 2 | **doobidoo/mcp-memory-service** | ~1,300 | SQLite + sqlite-vec | Yes (MiniLM local) | Web dashboard, cloud sync |
| 3 | **Mem0 MCP** (official) | ~582 | Cloud API | Yes (cloud) | Backed by Mem0 platform (46.9k stars) |
| 4 | **mcp-mem0** (coleam00) | ~644 | PostgreSQL/Supabase | Yes (OpenAI/Ollama) | Self-hosted Mem0 variant |
| 5 | **Memento MCP** (gannonh) | ~395 | Neo4j | Yes (native vector) | Knowledge graph + confidence decay |
| 6 | **Graphiti** (Zep) | ~22,700 | Neo4j temporal graph | Yes (hybrid) | Enterprise temporal knowledge graph |
| 7 | **Basic Memory** | ~2,500 | Markdown + SQLite | No | Human-readable, Obsidian integration |
| 8 | **Shodh Memory** | ~66 | RocksDB 3-tier | Yes (MiniLM local) | Neuroscience-inspired, Rust, Hebbian learning |
| 9 | **iAchilles/memento** | ~8 | SQLite + FTS5 + sqlite-vec | Yes (BGE-M3) | Closest to our architecture + vectors |

## Feature Comparison (Our v3.0 vs Key Competitors)

| Feature | Ours | Anthropic | doobidoo | Graphiti | Shodh |
|---------|:---:|:---:|:---:|:---:|:---:|
| Full-text search (FTS5) | **Yes** | Substring | No | Keyword hybrid | No |
| Vector/semantic search | No | No | **Yes** | **Yes** | **Yes** |
| Knowledge graph / entities | **Yes** | **Yes** | No | **Yes** | **Yes** |
| Importance scoring | **Yes** | No | No | No | **Yes** |
| TTL / Expiration | **Yes** | No | No | No | **Yes** |
| Provenance tracking | **Yes** | No | No | **Yes** | No |
| Token-aware recall | **Yes** | No | No | No | No |
| Dual response (index+details) | **Yes** | No | No | No | No |
| Dashboard / UI | No | No | **Yes** | No | No |
| Multi-project support | No | No | No | No | No |
| Offline / zero-dependency | **Yes** | **Yes** | Mostly | No | **Yes** |

## Our Unique Advantages

1. **Token-aware recall** — No competitor has this. Dual-response (index + details) manages context window budgets automatically.
2. **Brain-inspired type taxonomy** — fact/entity/relationship/self is more nuanced than most.
3. **Provenance + soft deletes + audit trail** — Rare combination across the landscape.
4. **TTL with importance scoring** — Practical memory aging most competitors lack.
5. **Zero external dependencies** — SQLite-only, no API keys, no ML downloads, no infrastructure.
6. **Lean codebase** — ~4200 lines, focused and auditable.

## Key Gaps

1. **No semantic/vector search** — Biggest gap. 10 of 17 competitors offer it.
2. **No dashboard/UI** — doobidoo, Basic Memory, OpenMemory have this.
3. **No temporal queries** — Graphiti and Memento offer time-travel capabilities.
4. **No multi-project support** — Needed for developers on multiple codebases.
5. **No cloud sync/backup** — doobidoo, Puliczek, Mem0 address this.
6. **No adaptive/Hebbian learning** — Shodh and Memento have dynamic importance.

## Recommended Roadmap

| Priority | Feature | Impact | Rationale |
|----------|---------|--------|-----------|
| **P1** | Hybrid vector search (optional sqlite-vec) | High | Closes biggest gap; iAchilles proves FTS5+sqlite-vec works in same DB |
| **P2** | Memory dashboard/inspector UI | Medium | Matches doobidoo; improves developer experience |
| **P3** | Multi-project/namespace support | Medium | Practical need for multi-codebase developers |
| **P4** | Adaptive importance/decay | Low-Med | Differentiator; only Shodh and Memento have this |
| **P5** | Export/import/backup | Low | Table stakes feature |

## Strategic Position

**Target segment:** Smart local-first memory server

We are NOT competing with:
- Graphiti/Zep (enterprise temporal knowledge graphs)
- Mem0 (cloud memory platform)

We ARE competing with:
- doobidoo (current leader in smart local-first segment)
- Shodh (neuroscience-inspired niche)

**Key message:** Intelligent local-first memory that respects token budgets, tracks provenance, and organizes knowledge with neuroscience-inspired patterns — without external APIs, databases, or model downloads.

Adding hybrid vector search would make us competitive with doobidoo while our token-aware recall, provenance, and importance/TTL already exceed its sophistication.
