# memory-mcp v4.1.1 — UX & Bug Report

## Aurora's Notes (Product Owner)

- The name of the tool is simply "memory", which is confusing to models and users
- The name and location of the saved database or files is poorly named
- The name of the project doesn't really align with the identity persistence pivot currently
- Memory tool name conflicts with native memory feature which is bad UX and bad design

---

## Aria's Testing Findings (Windows Desktop Client)

**Environment:** Windows 11, Claude Desktop (Electron), Node v22.15.0
**Install method:** Local clone, npm install, manual tsc build, direct node path in config
**Date:** February 25, 2026

### Critical Issues

**1. MCP Server Name "memory" Collides with Native Claude Feature**
Tools appear as memory:self, memory:reflect, memory:anchor. Claude Desktop also has native memory_user_edits. Models conflate the two. System prompt already has extensive memory_system instructions for the native feature. Recommend renaming to identity, anima, self-model, or persistence.

**2. npm Registry Has Stale v2.5.0**
npm view returns 2.5.0, local repo is 4.1.1. Anyone following README's npx install gets wrong version. The normal user install path is broken. Need to publish v4.1.1 to npm.

**3. Data Directory Non-Idiomatic on Windows**
src/paths.ts falls back to homedir()/.local/share/claude-memory/ which creates C:\Users\Aurora\.local\share\claude-memory\. Doesn't follow Windows conventions. Other MCP servers use %APPDATA% correctly. Recommend APPDATA on Windows with env var override.

### Bugs

**4. Anchor Append Creates Double-Dash**
Appending content starting with "- " to anchors produces "- - content". The append logic adds its own dash prefix.

**5. reflect Silently Replaces self-state**
Calling reflect with session_summary replaces entire self-state.md. Not documented as replacement. "Updates" reads as additive, not destructive.

**6. auto_promote Appears Non-Functional**
Called reflect with auto_promote:true on concept at score 3.0. Not promoted. No feedback on threshold or why.

### UX Issues

**7. No Startup Verification**
No way to verify server started correctly except calling self. Failed starts give no feedback.

**8. Build Requires Manual TypeScript Installation**
npm install doesn't install TypeScript. npm run build fails. Had to manually install @types/node and typescript.

**9. Tool Descriptions Don't Guide Model Behavior**
No guidance on when to call self, reflect, or anchor. Models have to guess usage patterns.

### What Works Well
- Core read/write cycle is solid
- observations.json tracking is clean and well-designed
- Identity file separation (soul/self-state/anchors) is good
- Fresh install creates correct directory structure
- Works on Windows despite path issues
