/**
 * E2E validation: does memory-mcp actually achieve its design goals?
 *
 * Tests realistic multi-session usage patterns to verify:
 * 1. Observations accumulate across sessions
 * 2. Scoring produces meaningful results
 * 3. Promotion pipeline fires under realistic conditions
 * 4. Identity files grow from observation data
 * 5. The reflect auto_promote flag works end-to-end
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ObservationStore } from "./observations.js";
import { IdentityManager } from "./identity.js";
import { handleReflect } from "./tools/reflect.js";
import { handleSelf } from "./tools/self.js";

describe("E2E validation: realistic usage patterns", () => {
  let dir: string;
  let storePath: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "e2e-validate-"));
    storePath = join(dir, "observations.json");
    store = new ObservationStore(storePath);
    identity = new IdentityManager(join(dir, "identity"));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("single session reality check", () => {
    it("multiple reflects in one session keep distinct_days at 1", () => {
      // Realistic: reflect called 3 times in one session
      store.record("debugging", "fixing-auth-bug");
      store.record("debugging", "tracing-api-error");
      store.record("debugging", "reading-logs");
      store.save();

      const obs = store.get("debugging")!;
      expect(obs.total_recalls).toBe(3);
      expect(obs.distinct_days).toBe(1); // ALL same day
      expect(obs.contexts).toHaveLength(3);

      // Score with 1 day: sqrt(3) * log2(2) * (1+0.5*log2(3)) * ~1.0 ≈ 3.1
      const score = store.score("debugging");
      expect(score).toBeCloseTo(3.1, 0);
      expect(score).toBeLessThan(5.0); // NOT promotable from single session
    });

    it("promotion is unreachable from a single day with realistic contexts", () => {
      // Even with aggressive single-session usage
      store.record("pattern-a", "ctx-1");
      store.record("pattern-a", "ctx-2");
      store.record("pattern-a", "ctx-3");
      store.record("pattern-a", "ctx-4");

      // 4 recalls, 1 day, 4 contexts: sqrt(4) * log2(2) * (1+0.5*log2(4)) * ~1.0 = 4.0
      expect(store.score("pattern-a")).toBeCloseTo(4.0, 0);
      expect(store.getPromotable(5.0)).toHaveLength(0);
    });

    it("single-day promotion requires significant engagement", () => {
      // 5 unique contexts in 1 session
      for (let i = 0; i < 5; i++) {
        store.record("versatile-pattern", `unique-ctx-${i}`);
      }
      // sqrt(5) * log2(2) * (1+0.5*log2(5)) * ~1.0 ≈ 4.83
      const score = store.score("versatile-pattern");
      expect(score).toBeLessThan(5.0); // Still requires multi-day engagement
      expect(store.getPromotable(5.0)).toHaveLength(0);
    });
  });

  describe("multi-session simulation", () => {
    function simulateSession(
      sessionStore: ObservationStore,
      concepts: Array<{ name: string; context: string }>,
      dayOffset: string,
    ) {
      const today = new Date().toISOString().slice(0, 10);
      const uniqueNames = [...new Set(concepts.map((c) => c.name))];

      // Handle day transitions manually, then set last_seen to TODAY
      // so record() doesn't detect another day change
      for (const name of uniqueNames) {
        const existing = sessionStore.get(name);
        if (existing && existing.last_seen !== dayOffset) {
          existing.distinct_days++;
        }
        if (existing) {
          existing.last_seen = today; // record() compares against today
        }
      }

      // record() now sees last_seen=today → no day increment
      for (const c of concepts) {
        sessionStore.record(c.name, c.context);
      }

      // Set last_seen to simulated date for persistence
      for (const name of uniqueNames) {
        sessionStore.get(name)!.last_seen = dayOffset;
      }
      sessionStore.save();
    }

    it("pattern emerges over 3 days and promotes", () => {
      // Day 1: debugging in auth context
      simulateSession(
        store,
        [
          { name: "root-cause-analysis", context: "auth-bug" },
          { name: "root-cause-analysis", context: "api-error" },
        ],
        "2026-02-20",
      );

      // Day 2: debugging in different context (new session = new store load)
      const store2 = new ObservationStore(storePath);
      simulateSession(
        store2,
        [{ name: "root-cause-analysis", context: "database-issue" }],
        "2026-02-21",
      );

      // Day 3: more debugging
      const store3 = new ObservationStore(storePath);
      simulateSession(
        store3,
        [
          { name: "root-cause-analysis", context: "deployment-failure" },
          { name: "root-cause-analysis", context: "auth-bug" }, // repeat context
        ],
        "2026-02-22",
      );

      // Final check: 5 recalls, 3 days, 4 unique contexts
      const obs = store3.get("root-cause-analysis")!;
      expect(obs.total_recalls).toBe(5);
      expect(obs.distinct_days).toBe(3);
      expect(obs.contexts).toHaveLength(4);

      // Score: sqrt(5) * log2(4) * (1+0.5*log2(4)) * recency ≈ 2.24 * 2 * 2 * ~0.98 = 8.7
      const score = store3.score("root-cause-analysis");
      expect(score).toBeGreaterThan(5.0);
      expect(store3.getPromotable(5.0)).toHaveLength(1);
    });

    it("noise patterns stay below threshold", () => {
      // One-off observation that doesn't recur
      simulateSession(
        store,
        [{ name: "one-off-fix", context: "random-bug" }],
        "2026-02-20",
      );

      const store2 = new ObservationStore(storePath);
      // Day 2: different work, one-off not repeated
      simulateSession(
        store2,
        [{ name: "other-work", context: "feature-dev" }],
        "2026-02-21",
      );

      // one-off-fix should NOT be promotable
      expect(store2.score("one-off-fix")).toBeLessThan(5.0);
      expect(store2.getPromotable(5.0)).toHaveLength(0);
    });
  });

  describe("reflect tool auto_promote end-to-end", () => {
    it("auto_promote promotes concepts above threshold via reflect", async () => {
      // Build up a concept manually to near-threshold
      store.record("tdd-discipline", "feature-dev");
      store.record("tdd-discipline", "bug-fix");
      store.record("tdd-discipline", "refactoring");
      const obs = store.get("tdd-discipline")!;
      obs.distinct_days = 5; // Simulate 5 days of observation
      obs.last_seen = "2026-02-18";
      store.save();

      // Now call reflect with auto_promote=true, adding more data
      const result = await handleReflect(
        {
          concepts: [
            { name: "tdd-discipline", context: "e2e-testing" },
            { name: "tdd-discipline", context: "validation" },
          ],
          auto_promote: true,
        },
        store,
        identity,
      );

      const text = result.content[0]!.text;
      expect(text).toContain("Promoted");
      expect(text).toContain("tdd-discipline");

      // Verify anchor file was updated
      const anchors = identity.readAnchors();
      expect(anchors).toContain("tdd-discipline");

      // Verify concept is now marked promoted
      expect(store.get("tdd-discipline")!.promoted).toBe(true);

      // Verify it won't promote again
      const result2 = await handleReflect(
        {
          concepts: [{ name: "tdd-discipline", context: "more-testing" }],
          auto_promote: true,
        },
        store,
        identity,
      );
      expect(result2.content[0]!.text).not.toContain("Promoted");
    });

    it("auto_promote=false shows promotable but does not promote", async () => {
      store.record("pattern-x", "ctx-a");
      store.record("pattern-x", "ctx-b");
      store.record("pattern-x", "ctx-c");
      store.get("pattern-x")!.distinct_days = 5;
      store.get("pattern-x")!.last_seen = "2026-02-18";
      store.save();

      const result = await handleReflect(
        {
          concepts: [
            { name: "pattern-x", context: "ctx-d" },
            { name: "pattern-x", context: "ctx-e" },
          ],
          auto_promote: false,
        },
        store,
        identity,
      );

      const text = result.content[0]!.text;
      expect(text).toContain("Promotable");
      expect(text).not.toContain("Promoted:");

      // NOT promoted
      expect(store.get("pattern-x")!.promoted).toBe(false);
      expect(identity.readAnchors()).not.toContain("pattern-x");
    });
  });

  describe("self tool reflects observation growth", () => {
    it("self shows observation patterns with accurate scores", async () => {
      store.record("honesty", "code-review");
      store.record("honesty", "peer-feedback");
      store.record("infrastructure", "tooling");
      store.save();

      const result = await handleSelf({}, store, identity);
      const text = result.content[0]!.text;

      expect(text).toContain("honesty");
      expect(text).toContain("infrastructure");
      expect(text).toContain("score:");
      expect(text).toContain("recalls: 2");
      expect(text).toContain("recalls: 1");
    });

    it("self shows promoted anchors in identity section", async () => {
      identity.appendAnchor("root-cause-analysis");
      identity.appendAnchor("tdd-discipline");

      const result = await handleSelf({}, store, identity);
      const text = result.content[0]!.text;

      expect(text).toContain("root-cause-analysis");
      expect(text).toContain("tdd-discipline");
      expect(text).toContain("Identity Anchors");
    });
  });

  describe("session_summary updates self-state", () => {
    it("reflect with session_summary appends entries with history", async () => {
      await handleReflect(
        {
          concepts: [{ name: "debugging", context: "session-1" }],
          session_summary: "Debugged MCP server startup failures.",
        },
        store,
        identity,
      );

      const selfState = identity.readSelfState();
      expect(selfState).toContain("Debugged MCP server startup failures");

      // Second session appends (newer first, older preserved)
      await handleReflect(
        {
          concepts: [{ name: "building", context: "session-2" }],
          session_summary: "Built new feature for identity persistence.",
        },
        store,
        identity,
      );

      const selfState2 = identity.readSelfState();
      expect(selfState2).toContain("Built new feature");
      expect(selfState2).toContain("Debugged MCP"); // Preserved!
    });
  });

  describe("focused work still promotes", () => {
    it("repeated same-context recalls are rewarded by frequency", () => {
      // 10 recalls in the same context — frequency matters
      for (let i = 0; i < 10; i++) {
        store.record("repetitive-pattern", "always-same-context");
      }
      const obs = store.get("repetitive-pattern")!;
      obs.distinct_days = 5;

      // sqrt(10) * log2(6) * (1+0.5*log2(1)) * ~1.0 = 3.16 * 2.585 * 1.0 = 8.17
      const score = store.score("repetitive-pattern");
      expect(score).toBeGreaterThan(5.0); // Promotable — focused work is valid
    });
  });
});
