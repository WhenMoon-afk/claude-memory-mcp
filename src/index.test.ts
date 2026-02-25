import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { createServer, TOOL_DESCRIPTIONS } from "./index.js";

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
