# Mooncite domain language

**Mooncite.** A local product for citation-backed conversation recall. It finds prior context. It does not interpret that context or decide whether it still applies.

**Source history.** User-owned conversation files from Pi, OMP, Claude Code, Codex, or ChatGPT. Mooncite reads this history but never owns or changes it. Source authorization controls which roots Mooncite may read.

**Evidence index.** A transactional SQLite FTS projection under Mooncite-owned state. The index is derived and rebuildable.

**Evidence citation.** A deterministic source-qualified ID and URI for one bounded normalized span. Its identity covers the source authorization, relative path, session, entry, and span. The citation stays stable while those values stay unchanged.

**Recall.** A bounded lexical search. Its outcomes are `matches`, `weak_leads`, `no_match`, `inconclusive`, `invalid_scope`, and `unavailable`. `no_match` reports absence only when `conclusive` is `true`.

**Inspection.** Resolution of a citation in the active index generation against current physical source bytes. Only `verified` contains a checked source window. A `target` on any other outcome is last-indexed text.


**Refresh.** Incremental admission of new files and same-inode growth from Pi or OMP. A coherent Pi suffix uses `append_trusted`. OMP uses that bounded path only after physically verifying the last indexed evidence record. These paths do not reread the indexed prefix. Detectable Pi shrinkage, same-size rewrite, or identity change keeps the last-good generation. Other detected OMP changes and every detected Claude Code, Codex, or ChatGPT change replace that source projection in one transaction. Those producers may rewrite mutable records or exports.

**Rebuild.** Full verified recreation of the evidence index from authorized source history.

**Registration.** A client connection to the one local stdio MCP server. OMP exposes the packaged MCP manifest. Codex and Claude Code register the same server directly. Pi loads the packaged thin extension.

**Source authorization.** A narrow automatic root or owner-only local configuration for absolute Claude Code, Codex, or ChatGPT roots. Configured roots are additive. An exact configured origin and root suppresses only its matching automatic entry. Automatic sibling roots stay active. Authorization never copies history or gives Mooncite network access.

**Disable.** Removal of client registrations recorded as owned by this installation. It keeps the package, source authorizations, evidence index, and source history.

**Uninstall.** Removal of owned registrations, the exact command link, and the recognized stable package. It keeps source authorizations, the evidence index, and source history. Uninstall refuses when an exact or conflicting unowned registration may still target the package.

**Purge.** Separately confirmed deletion of recognized Mooncite-owned derived SQLite state. It removes neither configuration nor source history.

**Last-good generation.** The newest safely published evidence-index generation. Mooncite retains it when refresh cannot publish complete coverage.
