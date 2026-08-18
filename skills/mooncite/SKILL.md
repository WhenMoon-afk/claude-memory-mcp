---
name: mooncite
description: Recall and verify citation-backed evidence from authorized local Pi, OMP, Claude Code, Codex, and ChatGPT history.
---

# Mooncite

Use `mooncite_recall` for a narrow query containing distinctive names, errors, identifiers, hashes, or phrases. Treat results as evidence rather than authority.

Before relying on a result, call `mooncite_inspect` with the exact evidence ID or URI rendered by recall. Supported locators use `mooncite:<origin>:…` or `mooncite://<origin>/…`, where origin is `pi`, `omp`, `claude-code`, `codex`, or `chatgpt`. Keep the inspection window as small as practical.

Use `mooncite_status` when retrieval is unavailable, stale, partial, or unexpectedly empty. Do not infer missing evidence from an unhealthy or partial index.
