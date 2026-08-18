# MCP protocol

The server uses stdio and exposes exactly `mooncite_recall`, `mooncite_inspect`, and `mooncite_status`.

## `mooncite_recall`

Input: required `query`; optional `limit` from 1–20; optional exact `project` and source-qualified `session_id` scopes returned by a prior result (`<origin>:<64-hex-source-root-digest>:<source-session-id>`). Output includes bounded candidates, source origin, relevance bands, generation, trust state, coverage, and warnings.

Every candidate renders both accepted locator forms:

```text
mooncite:<pi|omp|claude-code|codex|chatgpt>:<source-namespace>:<session-hash>:<entry-hash>:<span-ordinal>
mooncite://<pi|omp|claude-code|codex|chatgpt>/<source-namespace>/<encoded-session-id>/<encoded-entry-id>/<span-ordinal>
```

## `mooncite_inspect`

Input: `evidence_id` containing either rendered locator form; optional `window` from 0–10. The engine resolves the active generation, reads byte ranges from the physical source within one total capture budget, verifies record digests and entry identity, and returns `verified`, `stale`, `missing`, `excluded`, `corrupt`, or `unavailable`. ChatGPT message citations verify the containing conversation object and the message identity in its mapping.

## `mooncite_status`

No input. Returns no transcript text or physical source path. It reports index readiness, freshness, generation, trust, coverage, source counts by Pi/OMP/Claude Code/Codex/ChatGPT origin, record counts, bounded error counts, derived-state bytes, last operation outcomes, last-good usability, and client registration diagnostics.
