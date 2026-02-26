import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleReflect } from "./reflect.js";
import { ObservationStore } from "../observations.js";
import { IdentityManager } from "../identity.js";

describe("handleReflect", () => {
  let dir: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "reflect-test-"));
    store = new ObservationStore(join(dir, "observations.json"));
    identity = new IdentityManager(join(dir, "identity"));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("records concepts in the observation store", async () => {
    const result = await handleReflect(
      {
        concepts: [
          { name: "root-cause-analysis", context: "debugging" },
          { name: "honesty", context: "values" },
        ],
      },
      store,
      identity,
    );

    expect(store.get("root-cause-analysis")).toBeDefined();
    expect(store.get("honesty")).toBeDefined();
    expect(result.content[0]!.text).toContain("2 new");
  });

  it("saves observation store to disk after recording", async () => {
    await handleReflect(
      { concepts: [{ name: "persistence", context: "identity" }] },
      store,
      identity,
    );

    // Load fresh store from same path — should have the data
    const fresh = new ObservationStore(join(dir, "observations.json"));
    expect(fresh.get("persistence")).toBeDefined();
  });

  it("reports promotable concepts when threshold crossed", async () => {
    // Pre-seed a concept that's close to promotion
    for (let i = 0; i < 10; i++) {
      store.record("deep-pattern", `ctx-${i % 5}`);
    }
    const obs = store.get("deep-pattern")!;
    obs.distinct_days = 7;
    store.save();

    const result = await handleReflect(
      { concepts: [{ name: "deep-pattern", context: "reflection" }] },
      store,
      identity,
    );

    expect(result.content[0]!.text).toContain("Promotable");
  });

  it("handles empty concepts array", async () => {
    const result = await handleReflect({ concepts: [] }, store, identity);
    expect(result.content[0]!.text).toContain("Recorded");
  });

  it("skips concepts with empty or whitespace-only names", async () => {
    const result = await handleReflect(
      {
        concepts: [
          { name: "", context: "test" },
          { name: "   ", context: "test" },
          { name: "valid-concept", context: "real" },
        ],
      },
      store,
      identity,
    );

    // Only the valid concept should be recorded
    expect(store.get("")).toBeUndefined();
    expect(store.get("   ")).toBeUndefined();
    expect(store.get("valid-concept")).toBeDefined();
    expect(result.content[0]!.text).toContain("1 new");
  });

  it("auto-promotes concepts above threshold when auto_promote is true", async () => {
    // Pre-seed a concept well above promotion threshold
    for (let i = 0; i < 15; i++) {
      store.record("core-pattern", `ctx-${i % 5}`);
    }
    store.get("core-pattern")!.distinct_days = 10;
    store.save();

    const result = await handleReflect(
      {
        concepts: [{ name: "core-pattern", context: "reflection" }],
        auto_promote: true,
      },
      store,
      identity,
    );

    // Should be marked as promoted in observation store
    expect(store.get("core-pattern")!.promoted).toBe(true);
    // Should be appended to identity anchors
    const anchors = identity.readAnchors();
    expect(anchors).toContain("core-pattern");
    // Should report in output
    expect(result.content[0]!.text).toContain("Promoted");
  });

  it("does not auto-promote when auto_promote is false or unset", async () => {
    for (let i = 0; i < 15; i++) {
      store.record("core-pattern", `ctx-${i % 5}`);
    }
    store.get("core-pattern")!.distinct_days = 10;
    store.save();

    await handleReflect(
      {
        concepts: [{ name: "core-pattern", context: "reflection" }],
      },
      store,
      identity,
    );

    // Should NOT be promoted
    expect(store.get("core-pattern")!.promoted).toBe(false);
    const anchors = identity.readAnchors();
    expect(anchors).not.toContain("core-pattern");
  });

  it("updates self-state with session summary when provided", async () => {
    await handleReflect(
      {
        concepts: [{ name: "focus", context: "work" }],
        session_summary: "Worked on building infrastructure today.",
      },
      store,
      identity,
    );

    const selfState = identity.readSelfState();
    expect(selfState).toContain("Worked on building infrastructure today.");
  });

  it("does not update self-state with whitespace-only session summary", async () => {
    const before = identity.readSelfState();
    await handleReflect(
      {
        concepts: [{ name: "test", context: "ctx" }],
        session_summary: "   ",
      },
      store,
      identity,
    );

    const after = identity.readSelfState();
    expect(after).toBe(before);
  });

  it("shows threshold feedback when auto_promote is true but nothing qualifies", async () => {
    // Record a concept with low score (below threshold of 5.0)
    store.record("new-concept", "first observation");
    store.save();

    const result = await handleReflect(
      {
        concepts: [{ name: "new-concept", context: "second observation" }],
        auto_promote: true,
      },
      store,
      identity,
    );

    const text = result.content[0]!.text;
    // Should tell the user nothing was promoted and why
    expect(text).toMatch(/no concepts.*threshold|threshold.*5/i);
  });

  it("reports pruned stale concepts in output", async () => {
    // Create a stale single-observation concept older than 30 days
    store.record("stale-pattern", "old-context");
    const obs = store.get("stale-pattern")!;
    obs.last_seen = "2020-01-01"; // Very old
    store.save();

    const result = await handleReflect(
      { concepts: [{ name: "fresh-pattern", context: "new" }] },
      store,
      identity,
    );

    expect(result.content[0]!.text).toContain("Pruned 1 stale");
    // Stale concept should be gone
    expect(store.get("stale-pattern")).toBeUndefined();
  });

  it("reports 0 concepts when all names are empty", async () => {
    const result = await handleReflect(
      {
        concepts: [
          { name: "", context: "test" },
          { name: "   ", context: "test" },
        ],
      },
      store,
      identity,
    );

    const text = result.content[0]!.text;
    expect(text).toContain("Recorded 0 concepts");
    // Should not contain score lines for empty names
    expect(text).not.toContain(": 0.0");
  });

  it("does not list the same concept twice when it appears multiple times in input", async () => {
    const result = await handleReflect(
      {
        concepts: [
          { name: "debugging", context: "auth-bug" },
          { name: "debugging", context: "api-error" },
        ],
      },
      store,
      identity,
    );

    const text = result.content[0]!.text;
    // Should show concept only once in score output
    const matches = text.match(/debugging/g);
    expect(matches).toHaveLength(1);
    // Should count as 1 new concept, not 1 new + 1 updated
    expect(text).toContain("1 new");
    expect(text).not.toContain("updated");
  });

  it("does not claim session summary saved when it was whitespace-only", async () => {
    const result = await handleReflect(
      {
        concepts: [{ name: "test", context: "ctx" }],
        session_summary: "   \n  ",
      },
      store,
      identity,
    );

    const text = result.content[0]!.text;
    expect(text).not.toContain("Session summary saved");
  });

  it("returns isError when store save fails", async () => {
    // Make the store path unwritable by pointing to a non-existent deep path
    const badStore = new ObservationStore("/nonexistent/path/obs.json");
    const result = await handleReflect(
      { concepts: [{ name: "test", context: "ctx" }] },
      badStore,
      identity,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error");
  });

  it("rolls back promoted flag in memory if anchor write fails", async () => {
    // Pre-seed a concept well above promotion threshold
    for (let i = 0; i < 15; i++) {
      store.record("fragile-pattern", `ctx-${i % 5}`);
    }
    store.get("fragile-pattern")!.distinct_days = 10;
    store.save();

    // Make appendAnchor throw
    vi.spyOn(identity, "appendAnchor").mockImplementation(() => {
      throw new Error("disk full");
    });

    const result = await handleReflect(
      {
        concepts: [{ name: "fragile-pattern", context: "reflection" }],
        auto_promote: true,
      },
      store,
      identity,
    );

    // The in-memory store should have promoted rolled back
    // (so a future save() doesn't persist bad state)
    expect(store.get("fragile-pattern")!.promoted).toBe(false);

    // Should report error, not success
    expect(result.isError).toBe(true);

    vi.restoreAllMocks();
  });
});
