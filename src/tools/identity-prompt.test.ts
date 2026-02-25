import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateIdentityPrompt } from "./identity-prompt.js";
import { ObservationStore } from "../observations.js";
import { IdentityManager } from "../identity.js";

describe("generateIdentityPrompt", () => {
  let dir: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "prompt-test-"));
    store = new ObservationStore(join(dir, "observations.json"));
    identity = new IdentityManager(join(dir, "identity"));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns messages array with identity context", () => {
    const result = generateIdentityPrompt(store, identity);
    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.messages[0]!.role).toBe("user");
  });

  it("includes soul content in prompt", () => {
    identity.writeSoul("# Soul\n\nI value honesty.");
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("I value honesty");
  });

  it("includes instructions to use reflect at session end", () => {
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("reflect");
    expect(text).toContain("session");
  });

  it("includes anchors when promoted patterns exist", () => {
    // appendAnchor adds entries below the template header
    identity.appendAnchor("root-cause-analysis");
    identity.appendAnchor("tdd-discipline");
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("Identity Anchors");
    expect(text).toContain("root-cause-analysis");
    expect(text).toContain("tdd-discipline");
  });

  it("excludes anchors section when only template header exists", () => {
    // Fresh install — ensureFiles creates template-only file
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).not.toContain("Identity Anchors");
  });

  it("includes self-state when session entries exist", () => {
    identity.appendSelfStateEntry("Validated memory-mcp end-to-end.");
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("Self-State");
    expect(text).toContain("Validated memory-mcp");
  });

  it("excludes self-state when only template exists", () => {
    // Fresh install — no appendSelfStateEntry called
    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).not.toContain("Self-State");
  });

  it("includes observed patterns when they exist", () => {
    store.record("debugging", "problem-solving");
    store.record("debugging", "architecture");
    store.save();

    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("debugging");
  });
});
