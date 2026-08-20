# Mooncite domain language

**Mooncite** — A local citation-backed history retrieval product. It finds prior context; it does not decide what that context means or whether it remains authoritative.

**Source history** — User-owned Pi, OMP, Claude Code, Codex, or ChatGPT conversation files. Pi and OMP use standard roots; narrow Claude Code, Codex, and ChatGPT roots are discovered automatically unless opted out, and configured roots can override them. Mooncite reads source history and never modifies or owns it.

**Evidence index** — A transactional, rebuildable SQLite FTS projection under Mooncite-owned state.

**Evidence citation** — A deterministic source-qualified identifier and URI for one bounded normalized span. It remains stable while the source authorization, relative path, session, entry, and span remain unchanged.

**Recall** — A bounded lexical search returning cited matches, weak leads, no match, or unavailable.

**Inspection** — Resolution of a citation in the active index generation and verification against current physical source bytes. Only a `verified` outcome contains a verified source window; any `target` on another outcome is last-indexed text.

**Derived memory** — An explicit agent-authored interpretation stored only when it cites 1–8 physically verified evidence anchors. It is never source evidence, truth, policy, or current authority.

**Evidence anchor** — A learned revision's saved canonical evidence ID/URI plus record, normalized-span, source-root, project, session, role, source-kind, parent, branch, and compaction values. Locator identity alone is insufficient provenance.

**Learned revision** — One immutable interpretation, scope, derivation metadata, and anchor set in the separate durable learned-memory database. A correction appends the next revision behind a stale-write guard rather than overwriting history.

**Quarantine** — Continued retention but default recall suppression when a learned revision's evidence content/context changes, disappears, or becomes deauthorized. Mooncite never silently rebinds its saved anchors.

**Refresh** — Incremental admission of new files and Pi same-inode growth. A coherently read Pi suffix is labeled `append_trusted`; that path does not reread the already indexed prefix. Detectable Pi shrinkage, same-size rewrites, or identity changes retain the last-good generation. Every detected change to authorized OMP, Claude Code, Codex, or ChatGPT history transactionally replaces that source projection because those producers may rewrite mutable records or exports.

**Rebuild** — Full verified recreation of the evidence index from authorized source history.

**Registration** — A client connection to the one local stdio MCP server. OMP's linked package exposes the packaged MCP manifest; Codex and Claude Code register the same server directly. Pi loads the packaged thin extension.

**Source authorization** — A narrow automatic root or an owner-only local configuration naming one absolute Claude Code, Codex, or ChatGPT root. Explicit authorization overrides the automatic root for that origin. Neither form copies history nor grants Mooncite network access.

**Disable** — Remove client registrations recorded as owned by this installation while preserving the package, source authorizations, evidence index, learned-memory config/database, and source history. `memory disable` separately hides learned tools while retaining learned state.

**Uninstall** — Refuse if an exact or conflicting unowned registration may still target the package; otherwise remove owned registrations, the exact command link, and the recognized stable package while preserving source authorizations, both databases, learned-memory configuration, and source history.

**Purge** — Separately confirmed deletion of recognized Mooncite-owned evidence and learned SQLite state. It removes neither configuration nor source history.

**Last-good generation** — The newest safely published evidence-index generation retained when refresh cannot publish complete coverage.
