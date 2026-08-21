# Architecture

## One engine

`MoonciteEngine` owns source discovery, ingestion, the evidence index, citation identity, recall, inspection, status, rebuild, and last-good recovery. Its public operations are `refresh`, `recall`, `inspect`, `status`, `rebuild`, bounded canonical `resolveEvidenceAnchors`, and `close`.

Exactly five adapters feed the engine:

- Pi session-format-v3 JSONL
- compatible OMP JSONL
- Claude Code project JSONL
- Codex rollout JSONL
- ChatGPT conversation JSON exports

`mooncite serve` runs one local stdio MCP server. Codex and Claude Code register it directly. OMP uses the packaged `.mcp.json`. Pi uses a thin extension that translates native tool calls to MCP and contains no retrieval logic.

## Evidence path

1. Mooncite discovers authorized local roots and reads admitted source files through Linux file descriptors.
2. It publishes searchable evidence to a derived SQLite and FTS5 projection in a transaction.
3. `mooncite_recall` performs bounded lexical search over that projection.
4. `mooncite_inspect` rereads the physical source bytes for one locator before returning a verified window.

Recall checks the active index first. Only a miss triggers one bounded incremental refresh and retry. `status` always refreshes. `rebuild` performs the explicit full reread.

Pi same-inode growth may append a coherently read suffix as `append_trusted`. Changes from OMP, Claude Code, Codex, and ChatGPT replace that source's projection in a transaction. A shrink, rewrite, identity change, or failed replacement keeps the usable last-good generation. Mooncite does not publish known partial coverage over it.

The evidence index is disposable and rebuildable. Source files are never repaired, rewritten, or treated as Mooncite-owned.

## Source roots

Pi and OMP use their client roots. Mooncite narrowly discovers the supported Claude Code, Codex, and local ChatGPT export roots. Owner-configured roots are additive. A configured origin/root pair suppresses only the automatic entry for that exact pair.

Symlinks are excluded. Mooncite keeps authorized roots and opened files physically contained and identity-checked through Linux file descriptors.

## Optional learned memory

Learned memory is off by default. When enabled, `LearnedMemoryStore` opens a separate owner-private `learned-memory.sqlite`. A learned-store failure does not disable evidence recall or inspection. Learned memory depends on a running evidence engine for anchor checks.

Learned revisions are immutable and declare one provenance kind: `verified`, `derived`, `current_context`, or `unanchored`. A revision's own anchors determine its quarantine state. Parent health never propagates to a derived child, and related recall stops after one hop.

Lifecycle metadata changes only through explicit activate, reinforce, and archive operations. Skill promotion creates a review candidate but never installs it. Hard deletion fails while a surviving relation or candidate still depends on the memory.
