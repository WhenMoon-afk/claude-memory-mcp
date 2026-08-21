# Security and data handling

## Source access

Mooncite runs only on Linux with procfs. It opens authorized roots and source files through Linux file descriptors. It rejects symlinks and checks that every file stays inside its authorized root.

It reads only supported conversation files from Pi, OMP, Claude Code, Codex, and ChatGPT export roots. Source history stays read-only. Mooncite never repairs, rewrites, moves, or deletes it.

## Local state

The evidence index is owner-private derived state. Mooncite can delete and rebuild it from unchanged sources. A failed refresh keeps a usable last-good index rather than replacing it with known partial coverage.

Learned memory is a separate, default-off database for agent-authored interpretations. It stores provenance metadata and anchor digests, not copied source windows. Learned-store failure does not disable evidence search.

Recall excerpts and inspection windows are bounded. Mooncite escapes unsafe control text. Status reports counts and safe labels, never transcript text or full physical source paths.

## Network and model boundary

Mooncite does not transport or upload history. It has no telemetry, account login, or remote-copy command. It does not read ChatGPT credentials or browser cookies. It does not scrape opaque application caches.

Text returned through an MCP call enters the receiving model's context. The model provider's data policy applies from that point. Copy or mount remote history locally with tools outside Mooncite before authorizing its root.

## Install and removal

Install and removal fail closed when Mooncite cannot prove safe ownership. Mooncite refuses unsafe paths, links, conflicting registrations, unrelated launchers, and unknown state entries. It does not overwrite or delete them.

`disable` and `uninstall` preserve source history, configuration, the evidence index, and learned memory. Confirmed `purge --yes` removes only recognized derived SQLite state. Source history is never a purge target.
