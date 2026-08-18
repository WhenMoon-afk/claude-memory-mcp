# MCP protocol

The server uses stdio and exposes exactly `mooncite_recall`, `mooncite_inspect`, and `mooncite_status`.

## `mooncite_recall`

Input: required `query`; optional `limit` from 1–20; optional exact `project` and source-qualified `session_id` scopes returned by a prior result (`<origin>:<64-hex-source-root-digest>:<source-session-id>`). Output includes bounded candidates, source origin, relevance bands, generation, trust state, coverage, and warnings.

`full_verified` means the current projection came from a full source read or transactional mutable-source replacement. `append_trusted` means Pi same-inode size growth was admitted from a coherently read suffix without rereading the previously indexed prefix. A full `rebuild` rereads authorized sources and restores `full_verified`.

Every candidate renders both accepted locator forms:

```text
mooncite:<pi|omp|claude-code|codex|chatgpt>:<source-namespace>:<session-hash>:<entry-hash>:<span-ordinal>
mooncite://<pi|omp|claude-code|codex|chatgpt>/<source-namespace>/<encoded-session-id>/<encoded-entry-id>/<span-ordinal>
```

## `mooncite_inspect`

Input: `evidence_id` containing either rendered locator form; optional `window` from 0–10. The engine resolves the locator only in the active index generation. When the source is available, it reads physical byte ranges within one total capture budget and checks record digests and entry identity. Outcomes are `verified`, `stale`, `missing`, `excluded`, `corrupt`, or `unavailable`. Only `verified` populates `window` with current-source-verified spans. A nonverified structured result can include `target` text from the active index; that text is not a verification of current source bytes. ChatGPT message citations verify both the containing conversation object and message identity in its mapping.

## `mooncite_status`

No input. Returns no transcript text or physical source path. It reports index readiness, freshness, generation, trust, coverage, source counts by Pi/OMP/Claude Code/Codex/ChatGPT origin, record and error counts, derived-state bytes, last refresh and rebuild outcomes, last-good usability, and Pi/OMP/Codex/Claude Code registration diagnostics.
