import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getSetupInstructions, runReflectCli } from "./cli.js";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";

describe("cli", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "cli-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("getSetupInstructions", () => {
    it("includes Claude Code setup command", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude mcp add");
      expect(output).toContain("@whenmoon-afk/memory-mcp");
    });

    it("includes Desktop config example", () => {
      const output = getSetupInstructions();
      expect(output).toContain("claude_desktop_config.json");
      expect(output).toContain("memory-mcp");
    });

    it("includes npx command in Desktop config", () => {
      const output = getSetupInstructions();
      expect(output).toContain("npx");
    });
  });

  describe("runReflectCli", () => {
    it("records concepts from JSON input", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      const input = JSON.stringify({
        concepts: [
          { name: "testing", context: "development" },
          { name: "persistence", context: "identity" },
        ],
        session_summary: "Built and tested features.",
      });

      await runReflectCli(input, storePath, identityDir);

      const store = new ObservationStore(storePath);
      expect(store.get("testing")).toBeDefined();
      expect(store.get("persistence")).toBeDefined();
      expect(store.get("testing")!.total_recalls).toBe(1);
    });

    it("updates self-state with session summary", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      const input = JSON.stringify({
        concepts: [{ name: "focus", context: "work" }],
        session_summary: "Productive session on infrastructure.",
      });

      await runReflectCli(input, storePath, identityDir);

      const freshIdentity = new IdentityManager(identityDir);
      expect(freshIdentity.readSelfState()).toContain(
        "Productive session on infrastructure.",
      );
    });

    it("throws on invalid JSON input", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");

      await expect(
        runReflectCli("not-json", storePath, identityDir),
      ).rejects.toThrow();
    });

    it("throws on missing concepts field", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      await expect(runReflectCli("{}", storePath, identityDir)).rejects.toThrow(
        /concepts/i,
      );
    });
  });
});
