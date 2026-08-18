# MCP protocol

The server uses stdio and exposes exactly `mooncite_recall`, `mooncite_inspect`, and `mooncite_status`.

## `mooncite_recall`

Input: required `query`; optional `limit` from 1–20; optional exact `project` and `session_id` scopes returned by a prior result. Output includes bounded candidates, relevance bands, generation, trust state, coverage, and warnings.

Every candidate renders both accepted locator forms:

```text
mooncite:pi:<session-id>:<entry-id>:<span-ordinal>
mooncite://pi/<encoded-session-id>/<encoded-entry-id>/<span-ordinal>
```

## `mooncite_inspect`

Input: `evidence_id` containing either rendered locator form; optional `window` from 0–10. The engine resolves the active generation, reads bounded byte ranges from the physical source, verifies record digests and entry identity, and returns `verified`, `stale`, `missing`, `excluded`, `corrupt`, or `unavailable`.

## `mooncite_status`

No input. Returns no transcript text or physical source path. It reports index readiness, freshness, generation, trust, coverage, source and record counts, bounded error counts, derived-state bytes, last operation outcomes, last-good usability, and client registration diagnostics.
