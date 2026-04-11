import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { ContinuityStore } from "./continuity/store.js";
import {
  createServer,
  runContinuityTool,
  TOOL_ANNOTATIONS,
  TOOL_DESCRIPTIONS,
  VERSION,
} from "./index.js";

describe("createServer", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "server-test-"));
    dbPath = join(dir, "continuity.db");
    process.env["CLAUDE_MEMORY_DB_PATH"] = dbPath;
  });

  afterEach(() => {
    delete process.env["CLAUDE_MEMORY_DB_PATH"];
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an MCP server instance", () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("opens the continuity database on startup", () => {
    createServer();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("runs the continuity tool handler directly", async () => {
    const store = new ContinuityStore(dbPath);

    const response = await runContinuityTool(store, { action: "doctor" });

    expect(response.content).toEqual([
      {
        type: "text",
        text: expect.stringContaining("\"schema_version\": 1"),
      },
    ]);

    store.close();
  });
});

describe("TOOL_DESCRIPTIONS", () => {
  it("continuity description guides the action surface", () => {
    expect(TOOL_DESCRIPTIONS.continuity).toMatch(/save|list|search|get/i);
    expect(TOOL_DESCRIPTIONS.continuity).toMatch(/node|related|doctor/i);
    expect(TOOL_DESCRIPTIONS.continuity).toMatch(/bundle|merge|delete/i);
  });
});

describe("TOOL_ANNOTATIONS", () => {
  it("conservatively describes the continuity dispatch tool side effects", () => {
    expect(TOOL_ANNOTATIONS.continuity).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});

describe("VERSION", () => {
  it("matches package.json version", () => {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
    );
    expect(VERSION).toBe(pkg.version);
  });
});
