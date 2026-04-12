import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getContinuityDataDir, getContinuityDbPath } from "./config.js";
import { readProjectConfig } from "./project-config.js";

const ORIGINAL_ENV = {
  APPDATA: process.env["APPDATA"],
  CLAUDE_MEMORY_DATA_DIR: process.env["CLAUDE_MEMORY_DATA_DIR"],
  CLAUDE_MEMORY_DB_PATH: process.env["CLAUDE_MEMORY_DB_PATH"],
  HOME: process.env["HOME"],
  XDG_DATA_HOME: process.env["XDG_DATA_HOME"],
};

function restoreEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("continuity config", () => {
  afterEach(() => {
    restoreEnv();
  });

  it("uses continuity-specific env overrides when present", () => {
    process.env["CLAUDE_MEMORY_DATA_DIR"] = "/tmp/continuity-data";
    process.env["CLAUDE_MEMORY_DB_PATH"] = "/tmp/continuity/custom.db";

    expect(getContinuityDataDir()).toBe("/tmp/continuity-data");
    expect(getContinuityDbPath()).toBe("/tmp/continuity/custom.db");
  });

  it("falls back to XDG data home when no explicit overrides are set", () => {
    delete process.env["CLAUDE_MEMORY_DATA_DIR"];
    delete process.env["CLAUDE_MEMORY_DB_PATH"];
    delete process.env["APPDATA"];
    process.env["XDG_DATA_HOME"] = "/tmp/xdg-data";

    const expectedDataDir = join("/tmp/xdg-data", "claude-memory");
    expect(getContinuityDataDir()).toBe(expectedDataDir);
    expect(getContinuityDbPath()).toBe(join(expectedDataDir, "continuity.db"));
  });
});

describe("readProjectConfig", () => {
  it("returns null when the repo config does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "continuity-project-config-"));

    expect(readProjectConfig(dir)).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });

  it("reads repo-local continuity config values", () => {
    const dir = mkdtempSync(join(tmpdir(), "continuity-project-config-"));
    writeFileSync(
      join(dir, ".claude-memory.json"),
      JSON.stringify({
        project_id: "project:notes-api",
        project_label: "Notes API",
        db_path: ".claude-memory/continuity.db",
      }),
    );

    expect(readProjectConfig(dir)).toEqual({
      project_id: "project:notes-api",
      project_label: "Notes API",
      db_path: ".claude-memory/continuity.db",
    });

    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores non-object config payloads", () => {
    const dir = mkdtempSync(join(tmpdir(), "continuity-project-config-"));
    writeFileSync(join(dir, ".claude-memory.json"), JSON.stringify([]));

    expect(readProjectConfig(dir)).toBeNull();

    rmSync(dir, { recursive: true, force: true });
  });
});
