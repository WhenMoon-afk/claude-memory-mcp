# Release Guide

This project publishes `@whenmoon-afk/memory-mcp` to npm. v3 is the stable continuity-journal baseline and intentionally keeps one supported binary:

```text
claude-memory-mcp
```

## Release Positioning

`claude-memory-mcp` is a lightweight local memory database and continuity journal for MCP clients and shell scripts. Do not position it as a full task tracker, dependency graph, multi-agent coordinator, transcript archive, cloud memory service, or replacement for native client memory.

The last npm-published v2 line was `2.5.0`. v3 publishes as `3.0.0` and removes the older identity-oriented surface in favor of the `continuity` MCP tool and the `claude-memory-mcp` CLI.

## Preconditions

- Confirm the working tree contains only intentional public release files.
- Keep local discussion notes, local tracker state, crash notes, and planning folders out of the release commit.
- Confirm the package metadata lists `3.0.0`, `dist/index.js`, and `./dist/index.d.ts`.
- Confirm npm registry state before publishing:

```bash
npm view @whenmoon-afk/memory-mcp version dist-tags name bin --json
```

## Local Verification

Run the full release gate:

```bash
npm run release:check
```

This runs:

- production dependency audit
- typecheck
- test suite
- build
- setup smoke test
- coverage thresholds
- package smoke test

Inspect the package contents without publishing:

```bash
npm pack --dry-run --json --ignore-scripts
```

The package should include public docs such as `README.md`, `CONTRACT.md`, `CHANGELOG.md`, `RELEASE.md`, `SECURITY.md`, `CONTRIBUTING.md`, and `LICENSE`.

## Publish Flow

After the release commit is reviewed and pushed to `main`, create and push the tag:

```bash
git tag v3.0.0
git push origin main
git push origin v3.0.0
```

The GitHub Actions publish workflow validates that the tag matches `package.json`, runs `npm run release:check`, and publishes with provenance:

```bash
npm publish --provenance --access public
```

After publishing, verify the registry:

```bash
npm view @whenmoon-afk/memory-mcp version dist-tags bin --json
npm view @whenmoon-afk/memory-mcp@3.0.0 dist.tarball --json
```

Expected result:

- `latest` dist-tag points at `3.0.0`
- package binary exposes `claude-memory-mcp`
- no legacy v2 binary names are present in the v3 package metadata

If the `latest` dist-tag does not point to `3.0.0`, fix it explicitly:

```bash
npm dist-tag add @whenmoon-afk/memory-mcp@3.0.0 latest
```

## Post-Publish Checks

Smoke-test the published package from npm:

```bash
npx -y @whenmoon-afk/memory-mcp@3.0.0 setup
```

Then verify the README badge and GitHub release page. Do not update repository metadata, close security-scan issues, or comment on forks until the v3 release is visible on npm and the user has approved those remote actions.
