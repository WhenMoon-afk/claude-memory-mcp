#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";
import { getDataDir, getObservationsPath, getIdentityDir } from "./paths.js";
import { handleReflect } from "./tools/reflect.js";
import { handleAnchor } from "./tools/anchor.js";
import { handleSelf } from "./tools/self.js";
import { generateIdentityPrompt } from "./tools/identity-prompt.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
);
export const VERSION: string = pkg.version;

export const TOOL_DESCRIPTIONS = {
  reflect:
    "End-of-session reflection. Records identity-relevant patterns (values, tendencies, recurring behaviors) — NOT project facts or one-time tasks. Concepts that recur across sessions get promoted to identity anchors. Stale single-observation concepts are auto-pruned. Call this at the end of each session.",
  anchor:
    'Write to a permanent identity file. Use "soul" for core truths, "self-state" for current state, "anchors" to append a grown identity pattern. Use sparingly for insights that should persist across all future sessions.',
  self: "Query current identity state. Returns all three identity files (soul, self-state, anchors) and top observed patterns with scores. Use at session start to load context, or anytime to check current state.",
} as const;

export function createServer(): McpServer {
  const store = new ObservationStore(getObservationsPath());
  const identity = new IdentityManager(getIdentityDir());
  identity.ensureFiles();

  const server = new McpServer({
    name: "identity",
    version: VERSION,
  });

  server.registerTool(
    "reflect",
    {
      title: "Reflect",
      description: TOOL_DESCRIPTIONS.reflect,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({
        concepts: z.array(
          z.object({
            name: z
              .string()
              .describe(
                "An identity pattern (e.g. 'root-cause-analysis', 'tdd-discipline', 'honest-communication'). Use kebab-case. Avoid project-specific task names.",
              ),
            context: z
              .string()
              .describe(
                "The context in which it was observed (e.g. 'debugging auth module', 'code review feedback')",
              ),
          }),
        ),
        session_summary: z
          .string()
          .optional()
          .describe("Brief summary of the session to save as self-state"),
        auto_promote: z
          .boolean()
          .optional()
          .describe(
            "If true, automatically promote concepts above threshold to identity anchors",
          ),
      }),
    },
    async (args) => handleReflect(args, store, identity),
  );

  server.registerTool(
    "anchor",
    {
      title: "Anchor",
      description: TOOL_DESCRIPTIONS.anchor,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
      inputSchema: z.object({
        target: z
          .enum(["soul", "self-state", "anchors"])
          .describe("Which identity file to write to"),
        content: z
          .string()
          .describe(
            "The content to write (soul/self-state: full replacement, anchors: appended)",
          ),
      }),
    },
    async (args) => handleAnchor(args, identity),
  );

  server.registerTool(
    "self",
    {
      title: "Self",
      description: TOOL_DESCRIPTIONS.self,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      },
      inputSchema: z.object({}),
    },
    async () => handleSelf({}, store, identity),
  );

  server.registerPrompt(
    "identity",
    {
      title: "Identity Context",
      description:
        "Load your persistent identity — soul, self-state, anchors, and observed patterns. Use at session start.",
    },
    () => generateIdentityPrompt(store, identity),
  );

  return server;
}

// Auto-start when run directly (via node dist/index.js, npx memory-mcp, or tsx)
const entryScript = process.argv[1] ?? "";
const isMainModule =
  entryScript.endsWith("index.js") ||
  entryScript.endsWith("index.ts") ||
  entryScript.endsWith("memory-mcp");
if (isMainModule) {
  const subcommand = process.argv[2];
  if (subcommand === "setup") {
    import("./cli.js").then(({ getSetupInstructions }) => {
      console.log(getSetupInstructions());
    });
  } else if (subcommand === "reflect") {
    const jsonArg = process.argv[3];
    if (!jsonArg) {
      console.error(
        'Usage: memory-mcp reflect \'{"concepts":[{"name":"...","context":"..."}]}\' ',
      );
      process.exit(1);
    }
    import("./cli.js").then(async ({ runReflectCli }) => {
      try {
        const output = await runReflectCli(
          jsonArg,
          getObservationsPath(),
          getIdentityDir(),
        );
        console.log(output);
      } catch (err) {
        console.error("Reflect failed:", err);
        process.exit(1);
      }
    });
  } else if (subcommand === "self") {
    import("./cli.js").then(async ({ runSelfCli }) => {
      try {
        const output = await runSelfCli(
          getObservationsPath(),
          getIdentityDir(),
        );
        console.log(output);
      } catch (err) {
        console.error("Self failed:", err);
        process.exit(1);
      }
    });
  } else if (subcommand === "anchor") {
    const target = process.argv[3];
    const content = process.argv[4];
    if (!target || !content) {
      console.error(
        "Usage: memory-mcp anchor <soul|self-state|anchors> <content>",
      );
      process.exit(1);
    }
    import("./cli.js").then(async ({ runAnchorCli }) => {
      try {
        const output = await runAnchorCli(target, content, getIdentityDir());
        console.log(output);
      } catch (err) {
        console.error("Anchor failed:", err);
        process.exit(1);
      }
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    server
      .connect(transport)
      .then(() => {
        console.error(`identity v${VERSION} ready (data: ${getDataDir()})`);
      })
      .catch((err: unknown) => {
        console.error("Failed to start identity server:", err);
        process.exit(1);
      });
  }
}
