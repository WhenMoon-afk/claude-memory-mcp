import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  getSetupInstructions,
  runReflectCli,
  runSelfCli,
  runAnchorCli,
} from "./cli.js";
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
      expect(output).toContain("identity");
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

    it("skips concepts with missing context field instead of storing undefined", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      // Concept missing "context" — should be skipped, not store undefined
      const input = JSON.stringify({
        concepts: [
          { name: "good-pattern", context: "real-context" },
          { name: "bad-pattern" },
        ],
      });

      await runReflectCli(input, storePath, identityDir);

      const store = new ObservationStore(storePath);
      expect(store.get("good-pattern")).toBeDefined();
      expect(store.get("good-pattern")!.contexts).toEqual(["real-context"]);
      // bad-pattern should either not exist or have no undefined in contexts
      const bad = store.get("bad-pattern");
      if (bad) {
        expect(bad.contexts).not.toContain(undefined);
        expect(bad.contexts).not.toContain(null);
      }
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

  describe("runSelfCli", () => {
    it("returns identity state", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();
      identity.writeSoul("I am a test agent.");

      const output = await runSelfCli(storePath, identityDir);
      expect(output).toContain("I am a test agent");
    });

    it("includes observation scores when present", async () => {
      const storePath = join(dir, "observations.json");
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      const store = new ObservationStore(storePath);
      store.record("debugging", "auth-bug");
      store.save();

      const output = await runSelfCli(storePath, identityDir);
      expect(output).toContain("debugging");
      expect(output).toContain("score:");
    });
  });

  describe("runAnchorCli", () => {
    it("writes to soul file", async () => {
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      const output = await runAnchorCli(
        "soul",
        "I am a new soul.",
        identityDir,
      );
      expect(output).toContain("Updated soul.md");
      expect(identity.readSoul()).toContain("I am a new soul");
    });

    it("appends to anchors file", async () => {
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      const output = await runAnchorCli(
        "anchors",
        "root-cause-analysis",
        identityDir,
      );
      expect(output).toContain("Appended");
      expect(identity.readAnchors()).toContain("root-cause-analysis");
    });

    it("rejects invalid target", async () => {
      const identityDir = join(dir, "identity");
      await expect(
        runAnchorCli("invalid", "content", identityDir),
      ).rejects.toThrow(/invalid target/i);
    });
  });

  describe("CLI entry point argument parsing", () => {
    it("anchor subcommand captures multi-word content from separate args", () => {
      const identityDir = join(dir, "identity");
      const identity = new IdentityManager(identityDir);
      identity.ensureFiles();

      // Simulate: memory-mcp anchor soul I am a persistent identity
      // Each word is a separate argv element (unquoted shell input)
      const output = execFileSync(
        "npx",
        [
          "tsx",
          "src/index.ts",
          "anchor",
          "soul",
          "I",
          "am",
          "a",
          "persistent",
          "identity",
        ],
        {
          cwd: join(import.meta.dirname!, ".."),
          env: { ...process.env, IDENTITY_DATA_DIR: dir },
          encoding: "utf-8",
          timeout: 10000,
        },
      );

      expect(output).toContain("Updated soul.md");
      const freshIdentity = new IdentityManager(identityDir);
      expect(freshIdentity.readSoul()).toContain("I am a persistent identity");
    });
  });
});
