import { generateDesktopConfig, getDesktopConfigPath } from "./setup.js";

export function getSetupInstructions(): string {
  const desktopPath = getDesktopConfigPath();
  const config = generateDesktopConfig();
  const configJson = JSON.stringify(config, null, 2);

  return `
# Identity Memory MCP — Setup

## Claude Code

Run this command:

  claude mcp add memory-mcp -- npx -y @whenmoon-afk/memory-mcp

## Claude Desktop

Add the following to your claude_desktop_config.json:
(${desktopPath})

${configJson}

## Verify

After setup, ask Claude to use the "self" tool to check identity state.
`.trim();
}
