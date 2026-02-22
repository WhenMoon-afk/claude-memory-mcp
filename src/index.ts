#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";
import { getObservationsPath, getIdentityDir } from "./paths.js";
import { handleReflect } from "./tools/reflect.js";
import { handleAnchor } from "./tools/anchor.js";
import { handleSelf } from "./tools/self.js";

export function createServer(): McpServer {
  const store = new ObservationStore(getObservationsPath());
  const identity = new IdentityManager(getIdentityDir());
  identity.ensureFiles();

  const server = new McpServer({
    name: "identity-memory",
    version: "4.0.0",
  });

  server.registerTool(
    "reflect",
    {
      title: "Reflect",
      description:
        "End-of-session reflection. Records observed concepts and their contexts, runs promotion scoring, and optionally updates self-state with a session summary.",
      inputSchema: z.object({
        concepts: z.array(
          z.object({
            name: z.string().describe("The concept or pattern observed"),
            context: z
              .string()
              .describe("The context in which it was observed"),
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
      description:
        'Explicitly write to an identity file. Use "soul" for core truths, "self-state" for current state, "anchors" to append a grown identity pattern.',
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
      description:
        "Query current identity state. Returns all three identity files (soul, self-state, anchors) and top observed patterns with scores.",
      inputSchema: z.object({}),
    },
    async () => handleSelf({}, store, identity),
  );

  return server;
}

// Auto-start when run directly
const isMainModule =
  process.argv[1]?.endsWith("index.js") ||
  process.argv[1]?.endsWith("index.ts");
if (isMainModule) {
  const subcommand = process.argv[2];
  if (subcommand === "setup") {
    import("./cli.js").then(({ getSetupInstructions }) => {
      console.log(getSetupInstructions());
    });
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    server.connect(transport).catch((err: unknown) => {
      console.error("Failed to start server:", err);
      process.exit(1);
    });
  }
}
