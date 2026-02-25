import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createServer, TOOL_DESCRIPTIONS, VERSION } from "./index.js";

describe("createServer", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "server-test-"));
    process.env["XDG_DATA_HOME"] = dir;
  });

  afterEach(() => {
    delete process.env["XDG_DATA_HOME"];
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns an MCP server instance", () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe("function");
  });

  it("creates identity files on startup", () => {
    createServer();
    const { readFileSync } = require("node:fs");
    const identityDir = join(dir, "claude-memory", "identity");
    expect(readFileSync(join(identityDir, "soul.md"), "utf-8")).toContain(
      "# Soul",
    );
  });
});

describe("TOOL_DESCRIPTIONS", () => {
  it("reflect description guides when to use", () => {
    expect(TOOL_DESCRIPTIONS.reflect).toMatch(/session.end|end.of.session/i);
    expect(TOOL_DESCRIPTIONS.reflect).toMatch(
      /NOT.*project.*facts|identity.*patterns/i,
    );
  });

  it("self description guides when to use", () => {
    expect(TOOL_DESCRIPTIONS.self).toMatch(/session.start|anytime/i);
  });

  it("anchor description guides when to use", () => {
    expect(TOOL_DESCRIPTIONS.anchor).toMatch(/permanent|persist|core/i);
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
