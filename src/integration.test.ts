import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "./index.js";

describe("integration: full workflow", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "integration-test-"));
    process.env["XDG_DATA_HOME"] = dir;
  });

  afterEach(() => {
    delete process.env["XDG_DATA_HOME"];
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates identity files on server creation", () => {
    createServer();
    const identityDir = join(dir, "claude-memory", "identity");
    expect(existsSync(join(identityDir, "soul.md"))).toBe(true);
    expect(existsSync(join(identityDir, "self-state.md"))).toBe(true);
    expect(existsSync(join(identityDir, "identity-anchors.md"))).toBe(true);
  });

  it("reflect → self roundtrip works", async () => {
    // Import handlers directly for integration test
    const { ObservationStore } = await import("./observations.js");
    const { IdentityManager } = await import("./identity.js");

    const store = new ObservationStore(
      join(dir, "claude-memory", "observations.json"),
    );
    const identity = new IdentityManager(
      join(dir, "claude-memory", "identity"),
    );
    identity.ensureFiles();

    // Simulate reflect
    const { handleReflect } = await import("./tools/reflect.js");
    await handleReflect(
      {
        concepts: [
          { name: "infrastructure-building", context: "development" },
          { name: "honesty", context: "values" },
        ],
        session_summary: "Built identity persistence infrastructure.",
      },
      store,
      identity,
    );

    // Simulate self
    const { handleSelf } = await import("./tools/self.js");
    const selfResult = await handleSelf({}, store, identity);
    const text = selfResult.content[0]!.text;

    expect(text).toContain("infrastructure-building");
    expect(text).toContain("honesty");
    expect(text).toContain("Built identity persistence infrastructure");
  });

  it("anchor writes are readable by self", async () => {
    const { ObservationStore } = await import("./observations.js");
    const { IdentityManager } = await import("./identity.js");
    const { handleAnchor } = await import("./tools/anchor.js");
    const { handleSelf } = await import("./tools/self.js");

    const store = new ObservationStore(
      join(dir, "claude-memory", "observations.json"),
    );
    const identity = new IdentityManager(
      join(dir, "claude-memory", "identity"),
    );
    identity.ensureFiles();

    // Write soul
    await handleAnchor(
      { target: "soul", content: "# Soul\n\nI value honesty above all." },
      identity,
    );

    // Read via self
    const selfResult = await handleSelf({}, store, identity);
    expect(selfResult.content[0]!.text).toContain("I value honesty above all");
  });

  it("observations persist across store instances", async () => {
    const { ObservationStore } = await import("./observations.js");

    const storePath = join(dir, "claude-memory", "observations.json");

    // Session 1: record concepts
    const store1 = new ObservationStore(storePath);
    store1.record("debugging", "problem-solving");
    store1.record("debugging", "architecture");
    store1.save();

    // Session 2: load and verify
    const store2 = new ObservationStore(storePath);
    const obs = store2.get("debugging");
    expect(obs).toBeDefined();
    expect(obs!.total_recalls).toBe(2);
    expect(obs!.contexts).toEqual(["problem-solving", "architecture"]);
  });

  it("promotion lifecycle: record → score → promote → anchor", async () => {
    const { ObservationStore } = await import("./observations.js");
    const { IdentityManager } = await import("./identity.js");

    const store = new ObservationStore(
      join(dir, "claude-memory", "observations.json"),
    );
    const identity = new IdentityManager(
      join(dir, "claude-memory", "identity"),
    );
    identity.ensureFiles();

    // Build up a strong pattern
    for (let i = 0; i < 15; i++) {
      store.record("root-cause-analysis", `ctx-${i % 5}`);
    }
    store.get("root-cause-analysis")!.distinct_days = 10;

    // Check it's promotable
    const promotable = store.getPromotable(5.0);
    expect(promotable.length).toBeGreaterThan(0);
    expect(promotable[0]!.concept).toBe("root-cause-analysis");

    // Promote it
    store.markPromoted("root-cause-analysis");
    identity.appendAnchor("root-cause-analysis");

    // Verify it's in anchors and no longer promotable
    const anchors = identity.readAnchors();
    expect(anchors).toContain("root-cause-analysis");
    expect(store.getPromotable(5.0)).toHaveLength(0);
  });
});
