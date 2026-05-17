#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchContinuityAction } from "./continuity/actions.js";
import { getContinuityDbPath } from "./continuity/config.js";
import { continuityActionSchema } from "./continuity/schema.js";
import type { ContinuityActionInput } from "./continuity/schema.js";
import { ContinuityStore } from "./continuity/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
export const VERSION: string = pkg.version;

export const TOOL_DESCRIPTIONS = {
  continuity:
    "Local continuity memory database. Dispatch read and write actions for save, list, search, get, neighbors, node, related, doctor, bundle, merge, and delete against local storage.",
} as const;

export const TOOL_ANNOTATIONS = {
  continuity: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
} as const;

export async function runContinuityTool(
  store: ContinuityStore,
  args: ContinuityActionInput,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const result = await dispatchContinuityAction(store, args);
  return {
    content: [{ type: "text", text: result.text }],
  };
}

export function createServer(): McpServer {
  const store = new ContinuityStore(getContinuityDbPath());

  const server = new McpServer({
    name: "continuity",
    version: VERSION,
  });
  const closeServer = server.close.bind(server);
  server.close = async () => {
    try {
      await closeServer();
    } finally {
      store.close();
    }
  };

  server.registerTool(
    "continuity",
    {
      title: "Continuity",
      description: TOOL_DESCRIPTIONS.continuity,
      annotations: TOOL_ANNOTATIONS.continuity,
      inputSchema: continuityActionSchema,
    },
    runContinuityTool.bind(undefined, store),
  );

  return server;
}

// Auto-start when run directly (via node dist/index.js, claude-memory-mcp, or tsx)
/* v8 ignore start */
const entryScript = process.argv[1] ?? "";
const isMainModule =
  entryScript.endsWith("index.js") ||
  entryScript.endsWith("index.ts") ||
  entryScript.endsWith("memory-mcp") ||
  entryScript.endsWith("claude-memory-mcp");
if (isMainModule) {
  const subcommand = process.argv[2];
  if (subcommand === "setup") {
    import("./cli.js").then(({ getSetupInstructions }) => {
      console.log(getSetupInstructions());
    });
  } else if (["self", "reflect", "anchor"].includes(subcommand ?? "")) {
    console.error(
      "This release replaces self/reflect/anchor with the continuity surface. See --help for save/list/search/get/neighbors/node/related/doctor/export/import/bundle/merge/delete.",
    );
    process.exit(1);
  } else if (subcommand && subcommand !== "serve") {
    import("./cli.js").then(async ({ runContinuityCli }) => {
      const store = new ContinuityStore(getContinuityDbPath());
      try {
        const output = await runContinuityCli(process.argv.slice(2), store);
        console.log(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Continuity command failed: ${message}`);
        process.exit(1);
      } finally {
        store.close();
      }
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    server
      .connect(transport)
      .then(() => {
        console.error(
          `continuity v${VERSION} ready (db: ${getContinuityDbPath()})`,
        );
      })
      .catch((err: unknown) => {
        console.error("Failed to start continuity server:", err);
        process.exit(1);
      });
  }
}
/* v8 ignore stop */
