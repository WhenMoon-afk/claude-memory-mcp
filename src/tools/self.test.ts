import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleSelf } from "./self.js";
import { ObservationStore } from "../observations.js";
import { IdentityManager } from "../identity.js";

describe("handleSelf", () => {
  let dir: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "self-test-"));
    store = new ObservationStore(join(dir, "observations.json"));
    identity = new IdentityManager(join(dir, "identity"));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns all three identity files when they have real content", async () => {
    identity.writeSoul("# Soul\n\nI am Cadence.");
    identity.writeSelfState("# Self-State\n\n## 2026-02-25\n\nFeeling good.");
    identity.appendAnchor("root-cause-analysis");

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    expect(text).toContain("I am Cadence");
    expect(text).toContain("Feeling good");
    expect(text).toContain("root-cause-analysis");
  });

  it("includes observation stats when observations exist", async () => {
    store.record("debugging", "problem-solving");
    store.record("honesty", "values");
    store.save();

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    expect(text).toContain("debugging");
    expect(text).toContain("honesty");
  });

  it("works with empty identity files", async () => {
    const result = await handleSelf({}, store, identity);
    expect(result.content[0]!.text).toBeDefined();
  });

  it("excludes template-only content from fresh install", async () => {
    // Fresh install has only template content — self should not show it
    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    expect(text).not.toContain("Core truths about who I am");
    expect(text).not.toContain("This file is carved");
    expect(text).not.toContain("Updated each session");
    expect(text).not.toContain(
      "Grown automatically from the observation store",
    );
  });

  it("shows truncation message when more than 10 patterns exist", async () => {
    // Create 12 patterns to trigger the "...and N more" text
    for (let i = 0; i < 12; i++) {
      store.record(`pattern-${i}`, `ctx-${i}`);
    }
    store.save();

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;
    expect(text).toContain("2 more observed patterns not shown");
  });

  it("includes top observations sorted by score", async () => {
    // Create observations with different strengths
    for (let i = 0; i < 5; i++) {
      store.record("strong-pattern", `ctx-${i}`);
    }
    store.get("strong-pattern")!.distinct_days = 5;

    store.record("weak-pattern", "ctx-a");
    store.save();

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    // Strong pattern should appear before weak
    const strongIdx = text.indexOf("strong-pattern");
    const weakIdx = text.indexOf("weak-pattern");
    expect(strongIdx).toBeLessThan(weakIdx);
  });
});
