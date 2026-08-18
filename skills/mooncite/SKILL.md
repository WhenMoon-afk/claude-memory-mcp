---
name: mooncite
description: Recall and verify citation-backed evidence from prior local Pi sessions.
---

# Mooncite

Use `mooncite_recall` for a narrow query containing distinctive names, errors, identifiers, hashes, or phrases. Treat results as evidence rather than authority.

Before relying on a result, call `mooncite_inspect` with either the exact `mooncite:pi:…` evidence ID or `mooncite://pi/…` URI rendered by recall. Keep the inspection window as small as practical.

Use `mooncite_status` when retrieval is unavailable, stale, partial, or unexpectedly empty. Do not infer missing evidence from an unhealthy or partial index.
