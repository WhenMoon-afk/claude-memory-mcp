# Continuity Contract

This document defines the stable public contract for `claude-memory-mcp` `v3`.

## Stable Surface

The project has two supported public surfaces:

- MCP tool: `continuity`
- CLI: `claude-memory-mcp`

The continuity MCP tool is intentionally compact and dispatch-style. Supported actions:

- `help`
- `save`
- `list`
- `search`
- `get`
- `neighbors`
- `node`
- `related`
- `doctor`
- `bundle`
- `merge`
- `delete`

Operational data-transfer commands are CLI-only:

- `doctor`
- `export`
- `backup --file <path>`
- `import --file <path>`
- `import --file <path> --dry-run`

## Schema Version

- Current schema version: `1`
- Current export format: `claude-memory-continuity-export`
- Current export envelope version: `1`

Schema versioning is explicit so forks and downstream tooling can reason about compatibility without inspecting SQLite internals.

## Artifact Contract

Stable artifact types:

- `snapshot`
- `decision`
- `project_state`
- `bundle`
- `meta_snapshot`

Artifacts store:

- stable id
- type
- title
- compact label
- compact preview
- summary
- optional project scope
- next steps
- structured body
- source refs
- timestamps

## Graph Contract

Stable node kinds:

- `project`
- `theme`
- `entity`

Stable relation patterns:

- artifact-to-node links such as `about_project`, `about_theme`, and `about_entity`
- artifact-to-artifact links such as `merges`

The exact ranking logic for neighbors and related artifacts may improve over time, but the graph remains inspectable through `node` and `related`.

## Progressive Disclosure

Default retrieval stays compact:

- `list` returns compact rows
- `search` returns compact rows
- `neighbors` returns nearby compact rows
- `related` explains linkage without dumping full artifact bodies

Full detail is only returned on explicit request, such as `get --full` or an export operation.

## Portability

`claude-memory-mcp export` emits a JSON envelope with:

- `format`
- `version`
- `schema_version`
- `exported_at`
- `artifacts`
- `nodes`
- `artifact_edges`
- `node_edges`
- `renders`

`claude-memory-mcp import --file <path>` expects that envelope and replaces the current store contents transactionally.

`claude-memory-mcp backup --file <path>` writes the same envelope to a file. `claude-memory-mcp import --file <path> --dry-run` validates the envelope and reports counts without replacing the current store.

## Runtime Policy

- Supported Node runtime: `>=20.0.0`
- Storage engine: local SQLite
- Telemetry: none
- Network requirement: none for normal operation

## Compatibility Notes

The following are intended to be stable within `v3`:

- artifact and node type names
- CLI command names
- MCP action names
- export envelope format id and versioning behavior
- dry-run import validation before data replacement

The following may evolve without being considered a breaking schema change:

- ranking heuristics
- text formatting details inside compact previews
- internal render generation details
- additional optional metadata fields
