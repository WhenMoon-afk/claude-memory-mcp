# CLAUDE.md

## What This Repo Ships

`@whenmoon-afk/memory-mcp` is a local-first continuity MCP server. The supported public surface is:

- one MCP tool: `continuity`
- one supported CLI: `claude-memory-mcp`
- one local SQLite database: `continuity.db`

The product is a basic local memory database and continuity journal. It stores snapshots, decisions, state records, bundles, and meta-snapshots so an agent can resume work with compact, relevant context.

## Architecture

```text
MCP client / CLI
  -> continuityActionSchema
  -> dispatchContinuityAction()
  -> ContinuityStore
  -> SQLite
  -> compact list/search/get/neighbor renderers
```

Important modules:

- `src/index.ts`: stdio MCP entrypoint and CLI routing
- `src/cli.ts`: supported CLI commands and setup instructions
- `src/continuity/schema.ts`: action dispatch schema
- `src/continuity/actions.ts`: public continuity dispatcher
- `src/continuity/store.ts`: persistence, search, neighbors, renders, merge behavior
- `src/continuity/render.ts`: raw, prompt, bridge, and bundle render modes
- `src/continuity/config.ts`: default data and database paths

## Commands

```bash
npm run check
npm run test:coverage
npm test
npm run build
npm run dev
npx -y @whenmoon-afk/memory-mcp setup
claude-memory-mcp serve
```

## Verification Contract

- `npm run check` is the baseline verifier for local work, pre-commit, and CI
- `npm run test:coverage` is the full coverage pass
- `npm run test:smoke` validates the built entrypoint without touching real user data

Do not claim work is complete without a fresh verification run.

## Public Repo and npm Release Policy

- GitHub is the public development record. It is okay to push reviewed, verified branches or merges without publishing a new npm version.
- npm is the stable distribution channel for users who install with `npx`, global npm installs, or package manager version ranges.
- Do not publish to npm just because code was pushed to GitHub or merged to `main`.
- Push to GitHub when the branch is useful to preserve or review and `npm run check` passes.
- Publish a stable npm version only for a deliberate release milestone after docs, changelog, package contents, and migration notes are ready and `npm run release:check` passes.
- Use npm pre-releases only when real installer-path dogfood is needed before stable release, for example `3.1.0-alpha.0`, `3.1.0-beta.0`, or `3.1.0-rc.0` with npm dist-tags such as `alpha`, `beta`, or `next`.
- Treat nightly or snapshot builds as optional future automation, not the default workflow for this package.

## Storage Rules

- Default database path: `~/.local/share/claude-memory/continuity.db` on Unix-like systems, `%APPDATA%\claude-memory\continuity.db` on Windows
- Override with `CLAUDE_MEMORY_DB_PATH`, `CLAUDE_MEMORY_DATA_DIR`, or repo-local `.claude-memory.json` `db_path`
- Keep storage local-first and inspectable
- Progressive disclosure is intentional: list/search/neighbors stay compact, full expansion is explicit

## Constraints

- MCP uses stdout for protocol traffic, so operational logs must go to stderr
- TypeScript runs in strict mode
- ESM-only project; use `.js` extensions in TypeScript imports
- Public docs must reflect the continuity product, not the removed identity server
- Plugin, hook, marketplace, and MCPB packaging paths are not part of the supported product surface
