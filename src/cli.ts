import { readFileSync, writeFileSync } from "node:fs";
import { generateDesktopConfig, getDesktopConfigPath } from "./setup.js";
import { dispatchContinuityAction } from "./continuity/actions.js";
import { continuityActionSchema } from "./continuity/schema.js";
import type { ContinuityStore } from "./continuity/store.js";

export function getSetupInstructions(): string {
  const desktopPath = getDesktopConfigPath();
  const config = generateDesktopConfig();
  const configJson = JSON.stringify(config, null, 2);

  return `
# Continuity MCP — Setup

## Any MCP Client

Use this stdio command:

  npx -y @whenmoon-afk/memory-mcp

The MCP tool name is "continuity".

## Claude Code

For Claude Code, you can register that command directly:

  claude mcp add continuity -- npx -y @whenmoon-afk/memory-mcp

If you install the package globally, the supported CLI command is:

  claude-memory-mcp serve

## Claude Desktop

Add the following to your claude_desktop_config.json:
(${desktopPath})

${configJson}

## Verify

After setup, ask the client to use the "continuity" tool with {"action":"list"}.
`.trim();
}

function parseFlags(args: string[]): {
  positionals: string[];
  values: Record<string, string[]>;
} {
  const positionals: string[] = [];
  const values: Record<string, string[]> = {};

  for (let index = 0; index < args.length; index++) {
    const current = args[index]!;
    if (!current.startsWith("--")) {
      positionals.push(current);
      continue;
    }

    const rawFlag = current.slice(2);
    if (!rawFlag) {
      throw new Error("Invalid flag --");
    }

    const equalsIndex = rawFlag.indexOf("=");
    if (equalsIndex !== -1) {
      const key = rawFlag.slice(0, equalsIndex);
      if (!key) {
        throw new Error(`Invalid flag ${current}`);
      }

      values[key] ??= [];
      values[key]!.push(rawFlag.slice(equalsIndex + 1));
      continue;
    }

    const key = rawFlag;
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      values[key] = ["true"];
      continue;
    }

    values[key] ??= [];
    values[key]!.push(next);
    index++;
  }

  return { positionals, values };
}

function assertKnownFlags(
  values: Record<string, string[]>,
  allowedFlags: string[],
  command: string,
): void {
  const allowed = new Set(allowedFlags);
  for (const key of Object.keys(values)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown flag --${key} for ${command}`);
    }
  }
}

function renderCliHelp(): string {
  return [
    "Commands:",
    "  save --type <type> --title <title> --summary <summary> [--project <project>] [--theme <theme>] [--entity <entity>] [--next <step>]",
    "  list [--project <project>]",
    "  search <query>",
    "  get <id> [--compact|--full]",
    "  neighbors <id>",
    "  node <node-id>",
    "  related <id> [--via <nodes|edges|all>]",
    "  doctor",
    "  export",
    "  backup --file <path>",
    "  import --file <path>",
    "  bundle [--project <project>]",
    "  merge <id> <id> [--type <bundle|meta_snapshot>] [--title <title>]",
    "  delete <id>",
  ].join("\n");
}

function getSingleValue(
  values: Record<string, string[]>,
  key: string,
): string | undefined {
  return values[key]?.[0];
}

export async function runContinuityCli(
  argv: string[],
  store: ContinuityStore,
): Promise<string> {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "--help") {
    return renderCliHelp();
  }

  const { positionals, values } = parseFlags(rest);

  if (command === "save") {
    assertKnownFlags(
      values,
      ["type", "title", "summary", "project", "theme", "entity", "next"],
      command,
    );
    const parsed = continuityActionSchema.parse({
      action: "save",
      type: getSingleValue(values, "type"),
      title: getSingleValue(values, "title"),
      summary: getSingleValue(values, "summary"),
      project: getSingleValue(values, "project"),
      themes: values["theme"],
      entities: values["entity"],
      next_steps: values["next"],
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "list") {
    assertKnownFlags(values, ["project"], command);
    const parsed = continuityActionSchema.parse({
      action: "list",
      project: getSingleValue(values, "project"),
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "search") {
    assertKnownFlags(values, [], command);
    const parsed = continuityActionSchema.parse({
      action: "search",
      query: positionals.join(" "),
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "get") {
    assertKnownFlags(values, ["compact", "full"], command);
    const parsed = continuityActionSchema.parse({
      action: "get",
      id: positionals[0],
      detail: values["full"] ? "full" : values["compact"] ? "compact" : undefined,
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "neighbors") {
    assertKnownFlags(values, [], command);
    const parsed = continuityActionSchema.parse({
      action: "neighbors",
      id: positionals[0],
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "node") {
    assertKnownFlags(values, [], command);
    const parsed = continuityActionSchema.parse({
      action: "node",
      id: positionals[0],
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "related") {
    assertKnownFlags(values, ["via"], command);
    const parsed = continuityActionSchema.parse({
      action: "related",
      id: positionals[0],
      via: getSingleValue(values, "via"),
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "doctor") {
    assertKnownFlags(values, [], command);
    const parsed = continuityActionSchema.parse({
      action: "doctor",
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "export") {
    assertKnownFlags(values, [], command);
    return JSON.stringify(store.exportData(), null, 2);
  }

  if (command === "backup") {
    assertKnownFlags(values, ["file"], command);
    const file = getSingleValue(values, "file");
    if (!file) {
      throw new Error("backup requires --file <path>");
    }

    const data = store.exportData();
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
    return `Backed up ${data.artifacts.length} artifacts to ${file}`;
  }

  if (command === "import") {
    assertKnownFlags(values, ["file", "dry-run"], command);
    const file = getSingleValue(values, "file");
    if (!file) {
      throw new Error("import requires --file <path>");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      throw new Error("Invalid continuity export: file must contain valid JSON.");
    }

    const result = store.importData(parsed, { dryRun: values["dry-run"] !== undefined });
    const verb = result.dry_run ? "Validated" : "Imported";
    return `${verb} ${result.artifact_count} artifacts from ${file}`;
  }

  if (command === "bundle") {
    assertKnownFlags(values, ["project"], command);
    const parsed = continuityActionSchema.parse({
      action: "bundle",
      project: getSingleValue(values, "project"),
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "merge") {
    assertKnownFlags(values, ["type", "title"], command);
    const parsed = continuityActionSchema.parse({
      action: "merge",
      ids: positionals,
      type: getSingleValue(values, "type"),
      title: getSingleValue(values, "title"),
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  if (command === "delete") {
    assertKnownFlags(values, [], command);
    const parsed = continuityActionSchema.parse({
      action: "delete",
      id: positionals[0],
    });
    return (await dispatchContinuityAction(store, parsed)).text;
  }

  return renderCliHelp();
}
