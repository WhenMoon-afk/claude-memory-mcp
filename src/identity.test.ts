import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IdentityManager } from "./identity.js";

describe("IdentityManager", () => {
  let dir: string;
  let mgr: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "identity-test-"));
    mgr = new IdentityManager(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("ensureFiles", () => {
    it("creates all three identity files if missing", () => {
      mgr.ensureFiles();
      expect(readFileSync(join(dir, "soul.md"), "utf-8")).toContain("# Soul");
      expect(readFileSync(join(dir, "self-state.md"), "utf-8")).toContain(
        "# Self-State",
      );
      expect(readFileSync(join(dir, "identity-anchors.md"), "utf-8")).toContain(
        "# Identity Anchors",
      );
    });

    it("does not overwrite existing files", () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "soul.md"), "# My Custom Soul\n\nI am unique.");
      mgr.ensureFiles();
      expect(readFileSync(join(dir, "soul.md"), "utf-8")).toBe(
        "# My Custom Soul\n\nI am unique.",
      );
    });
  });

  describe("readSoul", () => {
    it("returns soul.md content", () => {
      mgr.ensureFiles();
      const content = mgr.readSoul();
      expect(content).toContain("# Soul");
    });

    it("returns empty string if file missing", () => {
      expect(mgr.readSoul()).toBe("");
    });
  });

  describe("readSelfState", () => {
    it("returns self-state.md content", () => {
      mgr.ensureFiles();
      expect(mgr.readSelfState()).toContain("# Self-State");
    });
  });

  describe("readAnchors", () => {
    it("returns identity-anchors.md content", () => {
      mgr.ensureFiles();
      expect(mgr.readAnchors()).toContain("# Identity Anchors");
    });
  });

  describe("writeSoul", () => {
    it("writes to soul.md", () => {
      mgr.ensureFiles();
      mgr.writeSoul("# Soul\n\nI value honesty.");
      expect(readFileSync(join(dir, "soul.md"), "utf-8")).toBe(
        "# Soul\n\nI value honesty.",
      );
    });
  });

  describe("writeSelfState", () => {
    it("writes to self-state.md", () => {
      mgr.ensureFiles();
      mgr.writeSelfState("# Self-State\n\nFeeling focused.");
      expect(readFileSync(join(dir, "self-state.md"), "utf-8")).toBe(
        "# Self-State\n\nFeeling focused.",
      );
    });
  });

  describe("appendAnchor", () => {
    it("appends a new anchor to identity-anchors.md", () => {
      mgr.ensureFiles();
      mgr.appendAnchor("I tend toward root-cause analysis over workarounds");
      const content = readFileSync(join(dir, "identity-anchors.md"), "utf-8");
      expect(content).toContain(
        "I tend toward root-cause analysis over workarounds",
      );
    });

    it("preserves existing anchors when appending", () => {
      mgr.ensureFiles();
      mgr.appendAnchor("First anchor");
      mgr.appendAnchor("Second anchor");
      const content = readFileSync(join(dir, "identity-anchors.md"), "utf-8");
      expect(content).toContain("First anchor");
      expect(content).toContain("Second anchor");
    });

    it("does not double-dash when content starts with '- '", () => {
      mgr.ensureFiles();
      mgr.appendAnchor("- already has dash prefix");
      const content = readFileSync(join(dir, "identity-anchors.md"), "utf-8");
      expect(content).not.toContain("- - already has dash prefix");
      expect(content).toContain("- already has dash prefix");
    });

    it("does not double-dash when content starts with '\\n- '", () => {
      mgr.ensureFiles();
      mgr.appendAnchor("\n- newline then dash");
      const content = readFileSync(join(dir, "identity-anchors.md"), "utf-8");
      expect(content).not.toContain("- - newline");
      expect(content).not.toContain("- \n- newline");
      expect(content).toContain("- newline then dash");
    });
  });

  describe("appendSelfStateEntry", () => {
    it("appends a dated entry to self-state", () => {
      mgr.ensureFiles();
      mgr.appendSelfStateEntry("First session work.");
      const content = mgr.readSelfState();
      expect(content).toContain("# Self-State");
      expect(content).toContain("First session work.");
      expect(content).toMatch(/## \d{4}-\d{2}-\d{2}/);
    });

    it("preserves previous entries (newer first)", () => {
      mgr.ensureFiles();
      mgr.appendSelfStateEntry("Session one.");
      mgr.appendSelfStateEntry("Session two.");
      const content = mgr.readSelfState();
      expect(content).toContain("Session one.");
      expect(content).toContain("Session two.");
      // Newer entry should appear first
      const posTwo = content.indexOf("Session two.");
      const posOne = content.indexOf("Session one.");
      expect(posTwo).toBeLessThan(posOne);
    });

    it("rotates old entries beyond maxEntries", () => {
      mgr.ensureFiles();
      for (let i = 1; i <= 7; i++) {
        mgr.appendSelfStateEntry(`Session ${i}.`);
      }
      const content = mgr.readSelfState();
      // Default maxEntries=5, so sessions 1 and 2 should be gone
      expect(content).not.toContain("Session 1.");
      expect(content).not.toContain("Session 2.");
      expect(content).toContain("Session 7."); // newest
      expect(content).toContain("Session 3."); // oldest kept
    });
  });

  describe("readAll", () => {
    it("returns all three files as a combined object", () => {
      mgr.ensureFiles();
      const all = mgr.readAll();
      expect(all.soul).toContain("# Soul");
      expect(all.selfState).toContain("# Self-State");
      expect(all.anchors).toContain("# Identity Anchors");
    });
  });
});
