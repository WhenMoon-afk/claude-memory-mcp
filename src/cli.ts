import { generateDesktopConfig, getDesktopConfigPath } from "./setup.js";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";
import { handleReflect } from "./tools/reflect.js";
import { handleSelf } from "./tools/self.js";
import { handleAnchor } from "./tools/anchor.js";

export function getSetupInstructions(): string {
  const desktopPath = getDesktopConfigPath();
  const config = generateDesktopConfig();
  const configJson = JSON.stringify(config, null, 2);

  return `
# Identity MCP — Setup

## Claude Code

Run this command:

  claude mcp add identity -- npx -y @whenmoon-afk/memory-mcp

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
  parsed.concepts = parsed.concepts.filter(
    (c: { name?: unknown; context?: unknown }) =>
      typeof c.name === "string" &&
      c.name.trim() !== "" &&
      typeof c.context === "string" &&
      c.context.trim() !== "",
  );
  const store = new ObservationStore(storePath);
  const identity = new IdentityManager(identityDir);
  identity.ensureFiles();

  const result = await handleReflect(parsed, store, identity);
  return result.content[0]!.text;
}

export async function runSelfCli(
  storePath: string,
  identityDir: string,
): Promise<string> {
  const store = new ObservationStore(storePath);
  const identity = new IdentityManager(identityDir);
  identity.ensureFiles();

  const result = await handleSelf({}, store, identity);
  return result.content[0]!.text;
}

export async function runAnchorCli(
  target: string,
  content: string,
  identityDir: string,
): Promise<string> {
  if (!["soul", "self-state", "anchors"].includes(target)) {
    throw new Error(
      `Invalid target: ${target}. Use soul, self-state, or anchors.`,
    );
  }
  const identity = new IdentityManager(identityDir);
  identity.ensureFiles();

  const result = await handleAnchor(
    { target: target as "soul" | "self-state" | "anchors", content },
    identity,
  );
  return result.content[0]!.text;
}
