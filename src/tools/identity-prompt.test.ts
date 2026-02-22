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

  it("includes observed patterns when they exist", () => {
    store.record("debugging", "problem-solving");
    store.record("debugging", "architecture");
    store.save();

    const result = generateIdentityPrompt(store, identity);
    const text = result.messages[0]!.content.text;
    expect(text).toContain("debugging");
  });
});
