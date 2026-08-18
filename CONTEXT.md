# Mooncite domain language

**Mooncite** — A local citation-backed history retrieval product. It finds prior context; it does not decide what that context means or whether it remains authoritative.

**Source history** — User-owned Pi session-format-v3 JSONL. Mooncite reads source history and never modifies or owns it.

**Evidence index** — A transactional, rebuildable SQLite FTS projection under Mooncite-owned state.

**Evidence citation** — A stable source-qualified identifier and URI for one bounded normalized span.

**Recall** — A bounded lexical search returning cited matches, weak leads, no match, or unavailable.

**Inspection** — Verification of a citation against current physical source bytes, followed by a bounded source window.

**Refresh** — Incremental admission of coherent appends and new files. Unsafe changes retain the last-good generation.

**Rebuild** — Full verified recreation of the evidence index from authorized source history.

**Registration** — A client connection to the one local stdio MCP server. Pi and OMP load the packaged thin extension; Codex and Claude Code register the same server directly.

**Disable** — Remove exact Mooncite client registrations while preserving the package, evidence index, and source history.

**Uninstall** — Remove exact registrations and the recognized stable package while preserving the evidence index and source history.

**Purge** — Separately confirmed deletion of recognized Mooncite-owned derived state. It never removes source history.

**Last-good generation** — The newest safely published evidence-index generation retained when refresh cannot publish complete coverage.
