import { generateDesktopConfig, getDesktopConfigPath } from "./setup.js";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";
import { handleReflect } from "./tools/reflect.js";

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

export async function runReflectCli(
  jsonInput: string,
  storePath: string,
  identityDir: string,
): Promise<string> {
  const parsed = JSON.parse(jsonInput);
  if (!Array.isArray(parsed.concepts)) {
    throw new Error("Missing required field: concepts (must be an array)");
  }
  const store = new ObservationStore(storePath);
  const identity = new IdentityManager(identityDir);
  identity.ensureFiles();

  const result = await handleReflect(parsed, store, identity);
  return result.content[0]!.text;
}
