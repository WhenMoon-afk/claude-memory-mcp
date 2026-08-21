# Mooncite repository contract

These instructions apply to the whole repository. Preserve the invariants below unless the owner explicitly changes the product contract.

## Product boundary

Mooncite is a Linux/procfs-only, local, citation-backed retrieval tool for prior conversation history. It helps an agent find and verify bounded evidence; it does **not** decide what evidence means, whether it is current, or what the user should do.

- Source history is user-owned and read-only. Never rewrite, repair, normalize in place, move, delete, or claim ownership of it.
- The SQLite evidence index is owner-private, transactional, derived, disposable, and rebuildable from authorized sources.
- Recall is bounded lexical retrieval. Inspection must re-read and verify the current physical source bytes before returning a bounded window. Status must not expose transcript text or full physical paths.
- Mooncite has no history network transport, telemetry, upload, SSH/remote-copy path, account login, export automation, credential/cookie access, or opaque application-cache scraping. Text returned through MCP enters the receiving model's privacy boundary; do not imply otherwise.
- Evidence retrieval is not an authority, policy, recommendation, truth-scoring, or durable-agent-memory layer. The owner-approved learned-memory mode is a separate, explicit, default-off layer for agent-authored interpretations with verified, derived, current-context, or unanchored provenance; it must never relabel an interpretation as source evidence.

## Fixed architecture

Treat these counts and seams as closed contracts except for the owner-approved optional learned-memory mode:

- Exactly five source origins: Pi, OMP, Claude Code, Codex, and ChatGPT.
- Default mode exposes exactly three MCP tools: `mooncite_recall`, `mooncite_inspect`, and `mooncite_status`. A valid explicit learned-memory enablement may additionally expose only `mooncite_memory_recall`, `mooncite_memory_inspect`, `mooncite_memory_write`, and `mooncite_memory_delete`.
- Exactly four client integrations: Pi, OMP, Codex, and Claude Code. They connect to one local stdio MCP server. ChatGPT is a source origin, not a client integration.
- `MoonciteEngine` owns ingestion, source adapters, coherent reads, citation identity, SQLite/FTS, refresh/rebuild, inspection, last-good behavior, and the bounded canonical-anchor resolver. `LearnedMemoryStore` owns the separate durable `learned-memory.sqlite`; learned-store failure must not disable evidence retrieval.
- The Pi extension is a thin native-to-MCP adapter. `.mcp.json`, Codex, and Claude Code registrations point to the same packaged server. Do not duplicate retrieval behavior in an integration.
- Pi and OMP use their standard roots. Only the narrow supported Claude Code, Codex, and local ChatGPT-export roots may be automatically discovered. Owner configuration adds optional roots. A configured origin/root pair suppresses only the automatic registration with that exact pair. Automatic sibling roots remain active. Authorization grants local reads only.
- Symlinks are excluded from source admission. Authorized roots and opened files remain physically contained and identity-checked through Linux file descriptors.
- Incremental publication is transactional. Pi same-inode size growth may be admitted as `append_trusted` after a coherent suffix read; this path does not reread the already indexed prefix. Detectable Pi shrinkage, same-size rewrites, or identity changes retain the last-good generation. Every detected change from supported mutable OMP, Claude Code, Codex, and ChatGPT producers replaces that source projection transactionally. Never publish knowingly partial coverage over a usable generation.

- Learned revisions are immutable and carry one explicit provenance form: verified revisions own 1–8 physically verified canonical evidence anchors; derived revisions link 1–8 exact parent revisions and may own 0–8 anchors; current-context revisions carry an explicit note and may own 0–8 anchors; unanchored revisions carry an explicit basis and own no anchors or parent links. Only a revision's own anchors can quarantine it. Relations are exact and one-hop only. Lifecycle metadata is explicit/manual and never mutates revisions or source evidence. Skill promotion produces a reviewed candidate artifact only and never installs it. Disable and uninstall retain learned state; hard deletion fails closed on surviving relation or candidate dependencies; confirmed purge recognizes the separate learned database and its SQLite sidecars.

Do not add, rename, alias, or silently generalize an origin, evidence tool, learned-memory tool, client, locator form, lifecycle operation, or transport as incidental work.

## Sources of truth

Edit the existing owner of a behavior; do not create a second path around it.

- `CONTEXT.md`: canonical domain terms and lifecycle meanings.
- `src/engine.ts`: engine contract, adapters, citations, indexing, refresh, rebuild, physical inspection, and bounded canonical anchor resolution.
- `src/source-config.ts`: source authorization, discovery, and effective-root precedence.
- `src/learned-memory.ts`: strict learned-memory opt-in, separate durable schema and v1 migration, immutable provenance/relation invariants, lexical and one-hop retrieval, own-anchor quarantine, explicit lifecycle metadata, reviewed skill candidates, and learned-only mutation.
- `src/mcp.ts`: the default three evidence schemas plus the four conditional learned-memory schemas and stdio surface.
- `src/clients.ts`: supported-client discovery and exact registration ownership/mutation.
- `src/lifecycle.ts`: install journal, staging, install/disable/uninstall/purge safety, and filesystem ownership.
- `src/cli.ts`: public CLI routing and process behavior.
- `src/identity.ts`, `package.json`, and `package-lock.json`: product/package identity and release version; keep them exact and synchronized.
- `src/pi/extension.ts`, `.mcp.json`, and `skills/mooncite/SKILL.md`: shipped receiver integration and usage guidance, never an alternate engine.
- `README.md`: concise public promise and install path. `docs/architecture.md`, `docs/protocol.md`, `docs/operations.md`, and `docs/security.md` own the detailed public contracts named by their titles.
- `test/*.test.ts` and `test/fixture.ts`: observable contract coverage and isolated source fixtures. `scripts/package-smoke.mjs` proves the built, shipped package rather than the source tree.

## Change discipline

- Fix the owning implementation and migrate every caller in the same change. Remove obsolete branches, exports, comments, and tests; do not leave compatibility aliases or two conventions.
- Prefer a direct, boring implementation. Complexity must earn its cost through a concrete safety or product contract. Do not add speculative migration machinery, fallbacks, retries, telemetry, abstractions, or network behavior outside the requested contract.
- Preserve evidence identity and lifecycle semantics deliberately. A citation-format, parser-admission, authorization, ownership, or deletion change is a public/security change even if types still compile.
- Treat source parsers as hostile-input boundaries: preserve byte provenance, bounds, containment, deterministic exclusion, and complete-coverage accounting. Never make malformed input look successfully indexed.
- Public claims must correspond to behavior a receiver can observe. Update affected code, tests, skill text, README, and detailed docs together; do not document aspirations or leave stale counts, paths, commands, privacy claims, or version examples.
- Use Mooncite domain terms consistently. In particular, do not call recall authoritative, call an index source history, call source registration a copy/import, or describe disable/uninstall as purge.

## Proof and tests

Every product change requires proof at the boundary that receives it, not only a helper-level unit assertion:

- Ingestion/citation changes: feed a realistic isolated source record through the public engine or MCP path, then inspect the resulting locator against physical bytes.
- MCP changes: connect as an MCP client and exercise the named tool/schema.
- CLI/lifecycle changes: run the built CLI and assert exit status, output, and filesystem effects.
- Client-registration changes: verify the exact format and behavior consumed by that client while proving unrelated entries survive.
- Packaging changes: build the shipped artifact, stage/install that artifact in isolation, and invoke its packaged CLI/server; do not substitute `src/` imports.

A bug fix should first reproduce the observable failure and then prove it absent. Add or tighten a permanent test for a changed contract or previously uncovered plausible regression; test boundaries, invariants, transitions, precedence, and real refusal paths rather than source text or plumbing.

Normal tests must use temporary source roots plus an isolated `HOME` and XDG/config/data/state paths. Stub client availability inside that fixture. **Never** let tests read or mutate the developer's real histories, Mooncite state, `~/.local/bin`, client configuration, registration, or installed package. Never require network access. If the actual receiver cannot run in the test environment, use its exact published format through the same public entrypoint and state that limitation in the verification result.

## Installation and lifecycle safety

Lifecycle code fails closed. Preserve all of these properties:

- Install verifies exact identity/layout and safe ownership before atomic placement. It refuses foreign packages, unsafe ancestors, links/hard links, unrelated launcher commands, and conflicting `mooncite` registrations rather than overwriting them.
- Registration ownership is journaled owner-only. Disable and uninstall remove only exact registrations recorded as owned; unrelated entries and commands always survive. An unavailable owned client preserves the package for safe retry.
- Reinstalling the same version is idempotent. There is no updater or in-place cross-version upgrade path: use the installed old version's executable to uninstall it, then install the new version fresh.
- Disable preserves package, index, source authorization, and source history. Uninstall additionally removes only the recognized stable package and exact command link while preserving index, authorization, and history.
- Purge is separate, explicitly confirmed, owner-marker-gated deletion of recognized derived SQLite state only. Unknown entries, directories, symlinks, and hard links cause refusal. Source history is never a purge target.

Exercise lifecycle scenarios only in disposable fixture homes. Never run install, disable, uninstall, purge, source registration, or client-registration mutation against the live user environment during ordinary development or validation.

## Versions and publication

Stable version numbers advance at most once per week. Tagged v4.0.5 remains the documented stable install. The current development identity and the candidate that this release will tag are `4.0.6-preview.1003.0`; do not replace stable install references without separate owner authorization for a future stable release. Untagged work is never published merely because files contain a candidate version. A candidate-version change must synchronize `src/identity.ts`, package manifests/lockfile, lifecycle expectations, and tests.

Before a release is eligible, the full verification suite and packaged-artifact smoke must pass on the supported Linux/procfs and Node baseline; the candidate must also prove clean isolated install, all four client paths, the exact default three-tool surface, the conditional learned-memory tools when enabled, source preservation, conflict refusal, disable/uninstall ownership, and confirmed purge boundaries. Review the actual shipped file set and public docs, not only the working tree.

Committing, tagging, pushing, publishing, or touching a live installation are separate, explicit owner-authorized gates. Mooncite is distributed from the tagged GitHub repository, not npm, unless the owner deliberately changes that public contract.
