import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleAnchor } from "./anchor.js";
import { IdentityManager } from "../identity.js";

describe("handleAnchor", () => {
  let dir: string;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anchor-test-"));
    identity = new IdentityManager(join(dir, "identity"));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes to soul.md when target is soul", async () => {
    const result = await handleAnchor(
      {
        target: "soul",
        content: "# Soul\n\nI value honesty above all.",
      },
      identity,
    );

    const soul = readFileSync(join(dir, "identity", "soul.md"), "utf-8");
    expect(soul).toBe("# Soul\n\nI value honesty above all.");
    expect(result.content[0]!.text).toContain("soul");
  });

  it("writes to self-state.md when target is self-state", async () => {
    const result = await handleAnchor(
      {
        target: "self-state",
        content:
          "# Self-State\n\nCurrently focused on identity infrastructure.",
      },
      identity,
    );

    const state = readFileSync(join(dir, "identity", "self-state.md"), "utf-8");
    expect(state).toContain("Currently focused on identity infrastructure.");
    expect(result.content[0]!.text).toContain("self-state");
  });

  it("appends to identity-anchors.md when target is anchors", async () => {
    const result = await handleAnchor(
      {
        target: "anchors",
        content: "I tend toward infrastructure over features",
      },
      identity,
    );

    const anchors = readFileSync(
      join(dir, "identity", "identity-anchors.md"),
      "utf-8",
    );
    expect(anchors).toContain("I tend toward infrastructure over features");
    expect(result.content[0]!.text).toContain("anchors");
  });

  it("reports when anchor already exists instead of claiming it was appended", async () => {
    await handleAnchor(
      { target: "anchors", content: "root-cause-analysis" },
      identity,
    );
    const result = await handleAnchor(
      { target: "anchors", content: "root-cause-analysis" },
      identity,
    );

    expect(result.content[0]!.text).toContain("already exists");
    expect(result.content[0]!.text).not.toContain("Appended");
  });

  it("rejects invalid target", async () => {
    const result = await handleAnchor(
      {
        target: "invalid" as "soul",
        content: "something",
      },
      identity,
    );

    expect(result.isError).toBe(true);
  });

  it("rejects empty content for soul target", async () => {
    const before = identity.readSoul();
    const result = await handleAnchor(
      { target: "soul", content: "" },
      identity,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("empty");
    // File should not be modified
    expect(identity.readSoul()).toBe(before);
  });

  it("rejects whitespace-only content for self-state target", async () => {
    const before = identity.readSelfState();
    const result = await handleAnchor(
      { target: "self-state", content: "   \n  " },
      identity,
    );

    expect(result.isError).toBe(true);
    // File should not be modified
    expect(identity.readSelfState()).toBe(before);
  });

  it("returns isError when file write fails", async () => {
    const badIdentity = new IdentityManager("/nonexistent/deep/path/identity");
    const result = await handleAnchor(
      { target: "soul", content: "test" },
      badIdentity,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error");
  });
});
