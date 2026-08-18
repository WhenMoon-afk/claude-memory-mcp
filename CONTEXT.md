# Mooncite domain language

**Mooncite** — A local citation-backed history retrieval product. It finds prior context; it does not decide what that context means or whether it remains authoritative.

**Source history** — User-owned Pi, OMP, Claude Code, Codex, or ChatGPT conversation files. Pi and OMP use standard roots; narrow Claude Code, Codex, and ChatGPT roots are discovered automatically unless opted out, and configured roots can override them. Mooncite reads source history and never modifies or owns it.

**Evidence index** — A transactional, rebuildable SQLite FTS projection under Mooncite-owned state.

**Evidence citation** — A stable source-qualified identifier and URI for one bounded normalized span.

**Recall** — A bounded lexical search returning cited matches, weak leads, no match, or unavailable.

**Inspection** — Verification of a citation against current physical source bytes, followed by a bounded source window.

**Refresh** — Incremental admission of coherent appends and new files. Unsafe Pi changes retain the last-good generation; authorized OMP, Claude Code, Codex, and ChatGPT rewrites are transactionally re-indexed because those producers may replace mutable records or exports.

**Rebuild** — Full verified recreation of the evidence index from authorized source history.

**Registration** — A client connection to the one local stdio MCP server. OMP discovers the packaged MCP manifest; Codex and Claude Code register the same server directly. Pi may load the packaged thin extension.

**Source authorization** — A narrow automatic root or an owner-only local configuration naming one absolute Claude Code, Codex, or ChatGPT root. Explicit authorization overrides the automatic root for that origin. Neither form copies history nor grants Mooncite network access.

**Disable** — Remove exact Mooncite client registrations while preserving the package, evidence index, and source history.

**Uninstall** — Remove exact registrations and the recognized stable package while preserving the evidence index and source history.

**Purge** — Separately confirmed deletion of recognized Mooncite-owned derived state. It never removes source history.

**Last-good generation** — The newest safely published evidence-index generation retained when refresh cannot publish complete coverage.
