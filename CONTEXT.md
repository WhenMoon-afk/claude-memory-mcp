# Mooncite domain language

**Mooncite.** A local product for citation-backed conversation recall. It finds prior context. It does not interpret that context or decide whether it still applies.

**Source history.** User-owned conversation files from Pi, OMP, Claude Code, Codex, or ChatGPT. Mooncite reads this history but never owns or changes it. Source authorization controls which roots Mooncite may read.

**Evidence index.** A transactional SQLite FTS projection under Mooncite-owned state. The index is derived and rebuildable.

**Evidence citation.** A deterministic source-qualified ID and URI for one bounded normalized span. Its identity covers the source authorization, relative path, session, entry, and span. The citation stays stable while those values stay unchanged.

**Recall.** A bounded lexical search. Its outcomes are `matches`, `weak_leads`, `no_match`, `inconclusive`, `invalid_scope`, and `unavailable`. `no_match` reports absence only when `conclusive` is `true`.

**Inspection.** Resolution of a citation in the active index generation against current physical source bytes. Only `verified` contains a checked source window. A `target` on any other outcome is last-indexed text.

**Learned memory.** An explicit agent-authored interpretation in the separate learned-memory database. It is never source evidence, verified truth, policy, or current authority.

**Learned provenance.** Every learned revision has one form:

- `verified` owns 1 to 8 physically verified evidence anchors.
- `derived` links 1 to 8 exact parent revisions and may own up to 8 evidence anchors.
- `current_context` records a bounded context note and may own up to 8 evidence anchors.
- `unanchored` records a bounded basis and has no anchors or parent links.

**Evidence anchor.** A learned revision's saved canonical evidence ID or URI and its identity fields. These fields cover the record, normalized span, source root, project, session, role, source kind, parent, branch, and compaction values. Locator identity alone is not enough provenance.

**Learned revision.** One immutable interpretation, scope, provenance record, and derivation record. A correction appends a revision behind a stale-write guard. It never overwrites history. Existing v1 evidence-backed rows migrate exactly to `verified`.

**Learned relation.** A `supports`, `contradicts`, `refines`, or `supersedes` link to one exact memory revision. Each link has an explicit reason. Recall may return a bounded one-hop related set. It never follows relations recursively.

**Learned lifecycle.** Explicit mutable metadata on a logical memory. It records active or archived state, metadata version, salience, last activation, and reinforcement count. Activate, reinforce, and archive are manual operations. They do not create revisions, decay automatically, or change source evidence.

**Quarantine.** Retention with default recall suppression. Quarantine applies when a revision's own evidence content or context changes, disappears, or loses authorization. Parent health does not propagate to derived children. Mooncite never silently rebinds a saved anchor.

**Skill candidate.** A bounded artifact proposed from exact learned revisions. It stays pending until explicit approval or rejection. Review never installs a skill.

**Refresh.** Incremental admission of new files and Pi same-inode growth. A coherent Pi suffix uses `append_trusted`. That path does not reread the indexed prefix. Detectable Pi shrinkage, same-size rewrite, or identity change keeps the last-good generation. Every detected OMP, Claude Code, Codex, or ChatGPT change replaces that source projection in one transaction. Those producers may rewrite mutable records or exports.

**Rebuild.** Full verified recreation of the evidence index from authorized source history.

**Registration.** A client connection to the one local stdio MCP server. OMP exposes the packaged MCP manifest. Codex and Claude Code register the same server directly. Pi loads the packaged thin extension.

**Source authorization.** A narrow automatic root or owner-only local configuration for absolute Claude Code, Codex, or ChatGPT roots. Configured roots are additive. An exact configured origin and root suppresses only its matching automatic entry. Automatic sibling roots stay active. Authorization never copies history or gives Mooncite network access.

**Disable.** Removal of client registrations recorded as owned by this installation. It keeps the package, source authorizations, evidence index, learned-memory configuration, learned-memory database, and source history. `memory disable` hides learned tools but keeps learned state.

**Uninstall.** Removal of owned registrations, the exact command link, and the recognized stable package. It keeps source authorizations, both databases, learned-memory configuration, and source history. Uninstall refuses when an exact or conflicting unowned registration may still target the package.

**Purge.** Separately confirmed deletion of recognized Mooncite-owned evidence and learned-memory SQLite state. It removes neither configuration nor source history.

**Last-good generation.** The newest safely published evidence-index generation. Mooncite retains it when refresh cannot publish complete coverage.
