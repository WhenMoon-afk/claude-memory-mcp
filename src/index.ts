#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchContinuityAction } from "./continuity/actions.js";
import { getContinuityDbPath } from "./continuity/config.js";
import {
  continuityActionSchema,
  continuityToolInputSchema,
} from "./continuity/schema.js";
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
      inputSchema: continuityToolInputSchema,
    },
    async (args) => runContinuityTool(store, continuityActionSchema.parse(args)),
  );

  return server;
}

export function isDirectEntrypoint(
  entryScript = process.argv[1],
  modulePath = fileURLToPath(import.meta.url),
): boolean {
  if (!entryScript) {
    return false;
  }

  const resolvedEntry = resolve(entryScript);
  const resolvedModule = resolve(modulePath);
  try {
    return realpathSync.native(resolvedEntry) === realpathSync.native(resolvedModule);
  } catch {
    return resolvedEntry === resolvedModule;
  }
}

export function createShutdownHandler(
  server: Pick<McpServer, "close">,
  exit: (code: number) => never | void = process.exit,
): () => Promise<void> {
  let closing = false;
  return async () => {
    if (closing) {
      return;
    }
    closing = true;
    try {
      await server.close();
    } finally {
      exit(0);
    }
  };
}

// Auto-start when run directly (via node dist/index.js, claude-memory-mcp, or tsx)
/* v8 ignore start */
if (isDirectEntrypoint()) {
  const subcommand = process.argv[2];
  if (subcommand === "--version" || subcommand === "-v") {
    console.log(VERSION);
  } else if (!subcommand || subcommand === "serve") {
    try {
      const server = createServer();
      const transport = new StdioServerTransport();
      const shutdown = createShutdownHandler(server);
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      server
        .connect(transport)
        .then(() => {
          console.error(
            `continuity v${VERSION} ready (db: ${getContinuityDbPath()})`,
          );
        })
        .catch(async (err: unknown) => {
          console.error("Failed to start continuity server:", err);
          await server.close();
          process.exit(1);
        });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to start continuity server: ${message}`);
      process.exit(1);
    }
  } else if (subcommand === "setup") {
    import("./cli.js").then(({ getSetupInstructions }) => {
      console.log(getSetupInstructions());
    });
  } else if (subcommand === "help" || subcommand === "--help" || subcommand === "-h") {
    import("./cli.js").then(async ({ runContinuityCli }) => {
      console.log(await runContinuityCli([subcommand], undefined));
    });
  } else if (["self", "reflect", "anchor"].includes(subcommand ?? "")) {
    console.error(
      "This release replaces self/reflect/anchor with the continuity surface. See --help for save/list/search/get/neighbors/node/related/doctor/export/import/bundle/merge/delete.",
    );
    process.exit(1);
  } else {
    import("./cli.js").then(async ({ runContinuityCli }) => {
      let store: ContinuityStore | undefined;
      try {
        store = new ContinuityStore(getContinuityDbPath());
        const output = await runContinuityCli(process.argv.slice(2), store);
        console.log(output);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Continuity command failed: ${message}`);
        process.exitCode = 1;
      } finally {
        store?.close();
      }
    });
  }
}
/* v8 ignore stop */
