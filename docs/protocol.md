# MCP protocol

The stdio server exposes exactly `mooncite_recall`, `mooncite_inspect`, and `mooncite_status` by default. A valid explicit learned-memory enablement conditionally adds the four tools documented below; the three evidence tools keep their source-evidence-only behavior.

## `mooncite_recall`

Input: required `query`; optional `limit` from 1–20; optional exact `project` and source-qualified `session_id` scopes returned by a prior result (`<origin>:<64-hex-source-root-digest>:<source-session-id>`). A unique bare session ID is also accepted and normalized; malformed, ambiguous, and deauthorized scopes return `invalid_scope`.

Output has one of six outcomes: `matches`, `weak_leads`, `no_match`, `inconclusive`, `invalid_scope`, or `unavailable`. Every envelope includes `conclusive`, human-readable `meaning`, structured `next`, generation, trust state, coverage, scope count, `echoesSuppressed`, and warnings. Candidates include exact project/session identities, a bounded excerpt with `omittedBytes`, duplicate count when collapsed, `isEcho`, and `match` (`kind`, relevance band, matched terms, missing terms, and term coverage). `full_verified` means the current projection came from a full source read or transactional mutable-source replacement. `append_trusted` means Pi same-inode size growth was admitted from a coherently read suffix without rereading the previously indexed prefix. A full `rebuild` rereads authorized sources and restores `full_verified`.

Every candidate renders both accepted locator forms:

```text
mooncite:<pi|omp|claude-code|codex|chatgpt>:<source-namespace>:<session-hash>:<entry-hash>:<span-ordinal>
mooncite://<pi|omp|claude-code|codex|chatgpt>/<source-namespace>/<encoded-session-id>/<encoded-entry-id>/<span-ordinal>
```

## `mooncite_inspect`

Input: `evidence_id` containing either rendered locator form; optional `window` from 0–10. The engine resolves the locator only in the active index generation. When the source is available, it reads physical byte ranges within one total capture budget and checks record digests and entry identity. Outcomes are `verified`, `stale`, `missing`, `excluded`, `corrupt`, or `unavailable`; the MCP envelope adds `conclusive`, `meaning`, and `next`. Only `verified` populates `window` with current-source-verified spans, and it verifies provenance rather than claim truth. A nonverified structured result can include `target` text from the active index; that text is not a verification of current source bytes. ChatGPT message citations verify both the containing conversation object and message identity in its mapping.

## `mooncite_status`

No input. Returns no transcript text or physical source path. It reports `ready`, `degraded`, or `unavailable`; meaning and next action; freshness, search usability, generation, trust, coverage, last successful refresh time, grouped source errors, source counts by Pi/OMP/Claude Code/Codex/ChatGPT origin, record counts, derived-state bytes, refresh/rebuild outcomes, and Pi/OMP/Codex/Claude Code registration diagnostics. `degraded` may remain searchable, but its empty recall results are inconclusive. Only when learned memory was enabled at server start, status adds owner-private learned-store readiness and counts. Learned-store failure is reported there but does not make evidence recall or inspection fail.

## Conditional learned-memory tools

Learned recall candidates and inspections label interpretations as `kind: derived_memory`; mutation envelopes are `derived_memory_write` and `derived_memory_delete`. Source anchors remain ordinary `mooncite:…` / `mooncite://…` evidence. A `verified` learned-memory provenance outcome means every saved anchor still matches its retained record, normalized-span, and context digests and was physically inspected; it does not assert the interpretation is true or currently authoritative.

Learned-operation failures return `kind: derived_memory_error`, the operation, `failed` or `unavailable`, and a bounded safe message. Writes and deletes never report success unless their transaction committed; stale-revision errors report the expected and current revision.

### `mooncite_memory_recall`

Input: required `query`; optional `limit` from 1–20; optional exact encoded `project`; optional `include_invalid`. The query is lexical or an exact `mooncite-memory:<uuid>` ID. A project scope returns that project plus global items. Normal recall omits quarantined items; `include_invalid: true` exposes content/context mismatches, unavailable anchors, and deauthorized anchors for review. Candidates include the current immutable revision, interpretation, scope, source evidence IDs/URIs, relevance, `provenanceState`, and `quarantined`.

### `mooncite_memory_inspect`

Input: required `memory_id`; optional positive `revision` (current by default); optional `window` from 0–2. The result keeps the derived interpretation separate from every saved source anchor, current canonical anchor metadata, and physical `mooncite_inspect` outcome. It resolves all anchors even if one fails. Historical revisions remain inspectable.

### `mooncite_memory_write`

Input: required `interpretation` (maximum 8 KiB UTF-8) and `evidence_ids` (1–8 unique Mooncite evidence IDs or URIs); optional `scope`; optional `memory_id` plus `expected_revision`. New same-project memory derives that exact project scope unless `global` is explicit; mixed-project creation requires explicit global scope. Every anchor is canonicalized and physically verified again before the transaction. Mooncite tool-result spans and memory-to-memory anchors are rejected.

Omit `memory_id` and `expected_revision` to create. Supplying a `memory_id` requires its exact current `expected_revision` and appends revision N+1; it never updates or deletes the older revision. The scope schema is exactly `{kind:\"global\"}` or `{kind:\"project\",project:\"<exact encoded project>\"}`.

### `mooncite_memory_delete`

Input: required `memory_id` and exact current `expected_revision`. It atomically deletes the logical learned item, all revisions, anchors, and learned FTS rows. It does not modify source files, source authorization, or `index.sqlite`.
