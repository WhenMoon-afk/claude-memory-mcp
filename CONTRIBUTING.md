# Contributing

This repository is kept as the stable v3 release line for `claude-memory-mcp`.

## Project Direction

Contributions are not actively solicited. Bug reports and narrow fixes may be reviewed when they address one of these areas:

- local-first reliability
- schema portability
- progressive disclosure
- graph inspectability
- CLI/MCP contract clarity
- release and security hygiene

Out of scope for the stable v3 release line:

- cloud sync
- telemetry
- provider-specific lock-in
- Claude plugin or hook packaging
- broad agent identity systems

## Before Opening a PR

Run the release verification command:

```bash
npm run release:check
```

This runs runtime dependency audit, typecheck, tests, build, smoke setup, coverage thresholds, and package smoke verification.

## Schema and Contract Changes

Changes to artifact types, node kinds, MCP actions, CLI commands, or export envelope behavior must update:

- `CONTRACT.md`
- `README.md`
- `CHANGELOG.md`
- public docs tests

## Dependency Changes

Prefer a small dependency surface.

- Use direct dependency upgrades first.
- Use `overrides` for targeted transitive security fixes.
- Use local patches or forks only when there is a specific upstream blocker.
- Do not vendor large packages into this repo without a clear maintenance reason.
