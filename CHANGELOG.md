# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- Tightened the public `3.0.0` reboot framing so docs, metadata, and packaging all describe the continuity product consistently
- Raised the supported runtime floor to Node `20`
- Strengthened local release verification with a dedicated `npm run release:check` script
- Aligned CI with the supported Node `20`+ release baseline and added production dependency audit coverage
- Moved package smoke verification into a maintainable script
- Tightened MCP tool annotations to conservatively describe local write and delete actions
- Hardened import validation for artifact fields, duplicate records, and dangling graph references
- Hardened package smoke verification to build from a clean `dist/` and reject legacy/test-only artifacts
- Reworked README positioning for the long-lived v3 continuity baseline
- Restored explicit TypeScript declaration metadata and sharpened npm discovery keywords for the v3 package
- Updated generated setup instructions to lead with the generic stdio MCP command before client-specific examples
- Replaced the Unix-only clean command with a portable Node script for cross-platform release checks
- Added Windows to the CI test matrix alongside Linux and macOS
- Tightened public positioning around the lightweight continuity-journal scope and documented npm publishing steps for v3
- Simplified the graph contract to project, theme, and entity nodes for the stable local-memory surface
- Switched to maintenance-focused issue and pull request intake for the stable v3 line
- Exposed the MCP continuity input schema through the SDK tool listing while keeping runtime validation centralized
- Tightened CLI argument validation for unknown flags, missing positional ids, ambiguous compact/full modes, and unknown commands
- Hardened package smoke verification to install the generated tarball in a temporary project with normal dependency lifecycle scripts and execute the packaged binary
- Refreshed maintenance dependencies and kept release verification on the supported Node 20 and TypeScript 5 lines
- Fixed direct-entrypoint detection so importing the package from another `index.js` file cannot accidentally start the CLI or stdio server
- Kept CLI help side-effect free by printing help before opening the local SQLite store
- Tightened import validation for artifact id conventions, graph node id/key consistency, node kind prefixes, and export timestamps

### Added

- Operational CLI commands for `doctor`, `export`, and `import`
- A public continuity contract document covering schema versioning and stable surface guarantees
- File-based `backup --file` support and `import --dry-run` validation for safer local maintenance
- Public contribution and security policy documents
- GitHub issue and pull request templates for reproducible, privacy-aware project intake
- Public contract, changelog, security, and contribution documents in the npm package
- A release guide covering npm verification, tag publishing, dist-tags, and post-publish smoke checks

## v3 Migration

`claude-memory-mcp` now exposes a continuity-first API.

Removed:

- `self`
- `reflect`
- `anchor`

Added:

- `continuity` MCP dispatch tool
- `claude-memory-mcp` CLI commands for `save`, `list`, `search`, `get`, `neighbors`, `node`, `related`, `doctor`, `export`, `backup`, `import`, `bundle`, `merge`, and `delete`
- SQLite-backed continuity artifacts for snapshots, decisions, state records, bundles, and meta-snapshots

---

## [3.0.0] - 2026-04-10

### Changed

- Rebooted the project into a basic local continuity server for MCP clients
- Replaced the public identity-oriented surface with a single `continuity` dispatch tool and mirrored CLI
- Renamed the supported binary to `claude-memory-mcp`
- Simplified the supported product surface to stdio MCP plus CLI only

### Added

- Continuity artifact types: `snapshot`, `decision`, `project_state`, `bundle`, and `meta_snapshot`
- Progressive disclosure for compact list, search, get, neighbor, and bundle flows
- Local SQLite storage with precomputed render modes
- Shared `npm run check` verification used by CI, pre-commit, and release paths
- Package smoke verification in CI and publish workflows

### Removed

- Claude plugin, hook, command, marketplace, and MCPB packaging paths
- Legacy identity-specific markdown and JSON storage code

---

The last published pre-reboot package line was `2.5.0`.
