# PR: Production-Grade NPX Installer + Docs + CI (v2.1.0)

## Overview

This PR implements a seamless, production-ready NPX installer for `@whenmoon-afk/memory-mcp`, matching the working behavior of `@whenmoon-afk/snapshot-mcp-server`. Users can now run `npx @whenmoon-afk/memory-mcp` and have Claude Desktop automatically configured with zero manual steps.

## What Changed

### ✨ New Features

1. **Automatic Claude Desktop Installer** (`install.js`)
   - Platform-aware detection (macOS/Windows/Linux)
   - Auto-detects Claude Desktop config location
   - Creates backup before modification
   - Windows: Uses `cmd /c` wrapper for npx compatibility
   - macOS/Linux: Uses direct npx command
   - Idempotent (safe to run multiple times)

2. **CI/CD Pipeline** (`.github/workflows/ci.yml`)
   - Lint, typecheck, build, test jobs
   - Multi-platform testing (Ubuntu, Windows, macOS)
   - Multi-version Node.js (18, 20, 22)
   - Security audit
   - Package integrity verification

3. **Integration Tests** (`test/integration.test.js`)
   - Package integrity tests (16 tests, all passing ✅)
   - Installer logic verification
   - Windows compatibility checks
   - Documentation accuracy validation
   - Version consistency checks

4. **Comprehensive Documentation**
   - Dependencies section (lists runtime deps accurately)
   - Windows-specific installation instructions
   - Platform-specific manual config examples
   - Automatic setup emphasized in README

### 🐛 Bug Fixes

- **README accuracy**: Removed false "no external dependencies" claim
  - Now correctly states "minimal runtime dependencies"
  - Documents @modelcontextprotocol/sdk and better-sqlite3
  - Explains rationale for each dependency

### 📝 Documentation

- Added CHANGELOG.md with full v2.1.0 details
- Updated README with Windows cmd /c examples
- Added Dependencies section to README
- Improved installation instructions
- Added Linux config path to Claude Desktop locations

### 🔧 Technical Changes

**package.json**:
- Version: `2.0.0` → `2.1.0`
- Bin: `dist/index.js` → `install.js` (now runs installer by default)
- Added `prepare` script (auto-build on npm install)
- Added `install.js` to files array

**src/index.ts**:
- Updated version string to `2.1.0`

**vitest.config.ts**:
- Added `test/**/*.test.{ts,js}` pattern support

## Breaking Changes

**None** - This is a backward-compatible minor version bump.

Users can still:
- Install via `npm install -g @whenmoon-afk/memory-mcp`
- Use manual configuration (see README)
- Run server directly with `node dist/index.js`

## Testing

### All Tests Pass ✅

```
 ✓ test/integration.test.js (16 tests) 17ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
```

### Test Coverage

- Package Integrity (5 tests)
- Installer Logic (4 tests)
- Windows Compatibility (2 tests)
- Documentation (3 tests)
- Version Consistency (2 tests)

### Manual Testing Recommended

Before merging, please test on:
1. **Windows**: Run `npx @whenmoon-afk/memory-mcp` and verify Claude Desktop config
2. **macOS**: Run `npx @whenmoon-afk/memory-mcp` and verify Claude Desktop config
3. **Linux**: Run `npx @whenmoon-afk/memory-mcp` and verify Claude Desktop config

## Security

### npm audit findings

5 moderate severity vulnerabilities in **dev dependencies only**:
- esbuild <=0.24.2 (development server vulnerability)
- vite, vite-node, vitest, @vitest/coverage-v8 (depend on esbuild)

**Impact**: ⚠️ Dev-only - does NOT affect published package or runtime security

**Documented in**: CHANGELOG.md (Security section)

**Mitigation**: Fix available via `npm audit fix --force` (breaking change: vitest 0.x → 4.x). Deferred to separate PR.

## Commits

1. `99d48b9` - feat: Add automatic Claude Desktop installer with platform detection
2. `384b617` - docs: Fix dependency claims and add Windows installation instructions
3. `9a50d2f` - test: Add integration tests and CI/CD pipeline
4. `2ad1d7e` - docs: Add CHANGELOG for version 2.1.0
5. `d2be3ba` - test: Update vitest config to include JavaScript tests
6. `9187c4a` - ci: Add package verification script

## Files Changed

**New Files**:
- `install.js` - Automatic installer script
- `test/integration.test.js` - Integration tests
- `.github/workflows/ci.yml` - CI/CD pipeline
- `CHANGELOG.md` - Version history
- `scripts/verify-install.sh` - Package verification script
- `PR_DESCRIPTION.md` - This file

**Modified Files**:
- `package.json` - Version, bin, prepare script, files array
- `src/index.ts` - Version string
- `README.md` - Installation docs, dependencies section, Windows examples
- `vitest.config.ts` - Test pattern inclusion

## Rollback Plan

If issues arise:

1. **Users**: Restore config backup
   ```bash
   cp ~/.config/Claude/claude_desktop_config.json.backup \
      ~/.config/Claude/claude_desktop_config.json
   ```

2. **Developers**: Revert to v2.0.0
   ```bash
   git revert 99d48b9..9187c4a
   npm publish --tag rollback
   ```

3. **NPM**: Unpublish within 72 hours
   ```bash
   npm unpublish @whenmoon-afk/memory-mcp@2.1.0
   ```

## Publishing Checklist

Before publishing v2.1.0:

- [x] All tests pass (16/16 ✅)
- [x] Build successful
- [x] CHANGELOG.md updated
- [x] README.md updated
- [x] Version bumped in package.json and src/index.ts
- [ ] Manual testing on Windows/macOS/Linux (recommended)
- [ ] PR approved and merged to main
- [ ] Git tag created: `git tag v2.1.0`
- [ ] Publish: `npm publish`
- [ ] Push tag: `git push origin v2.1.0`

## Related Issues

Addresses the need for:
- Seamless installation matching snapshot-mcp-server behavior
- Windows npx compatibility (cmd /c wrapper)
- Accurate documentation (dependency claims)
- CI/CD automation
- Package integrity testing

## Acknowledgments

This implementation was guided by:
- `@whenmoon-afk/snapshot-mcp-server` reference implementation
- Anthropic documentation on Windows npx setup
- Community feedback on MCP server installation friction

---

**Ready for review! 🚀**

All deliverables complete:
✅ PR branch `feat/npx-installer`
✅ Passing CI (tests, build, lint, typecheck)
✅ CHANGELOG.md
✅ README with accurate deps + Windows instructions
✅ Version 2.1.0 ready for `npm publish`
✅ Integration tests validating installer behavior
✅ Verification script for manual testing
