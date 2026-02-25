import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ObservationStore } from "./observations.js";

describe("ObservationStore", () => {
  let dir: string;
  let storePath: string;
  let store: ObservationStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "obs-test-"));
    storePath = join(dir, "observations.json");
    store = new ObservationStore(storePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("record", () => {
    it("creates a new observation for unseen concept", () => {
      store.record("debugging", "problem-solving");
      const obs = store.get("debugging");
      expect(obs).toBeDefined();
      expect(obs!.total_recalls).toBe(1);
      expect(obs!.distinct_days).toBe(1);
      expect(obs!.contexts).toEqual(["problem-solving"]);
      expect(obs!.promoted).toBe(false);
    });

    it("increments recalls for existing concept", () => {
      store.record("debugging", "problem-solving");
      store.record("debugging", "problem-solving");
      const obs = store.get("debugging");
      expect(obs!.total_recalls).toBe(2);
    });

    it("tracks distinct contexts", () => {
      store.record("debugging", "problem-solving");
      store.record("debugging", "architecture");
      const obs = store.get("debugging");
      expect(obs!.contexts).toEqual(["problem-solving", "architecture"]);
    });

    it("does not duplicate contexts", () => {
      store.record("debugging", "problem-solving");
      store.record("debugging", "problem-solving");
      const obs = store.get("debugging");
      expect(obs!.contexts).toEqual(["problem-solving"]);
    });

    it("updates last_seen on each record", () => {
      store.record("debugging", "ctx");
      const first = store.get("debugging")!.last_seen;
      // Record again — last_seen should be same or later
      store.record("debugging", "ctx");
      const second = store.get("debugging")!.last_seen;
      expect(second >= first).toBe(true);
    });

    it("auto-increments distinct_days when last_seen is a different day", () => {
      store.record("debugging", "ctx");
      const obs = store.get("debugging")!;
      // Simulate yesterday
      obs.last_seen = "2026-02-20";
      expect(obs.distinct_days).toBe(1);

      // Record today — should detect new day and increment
      store.record("debugging", "ctx");
      expect(store.get("debugging")!.distinct_days).toBe(2);
    });

    it("does not increment distinct_days when last_seen is today", () => {
      store.record("debugging", "ctx");
      const daysBefore = store.get("debugging")!.distinct_days;
      store.record("debugging", "ctx");
      expect(store.get("debugging")!.distinct_days).toBe(daysBefore);
    });
  });

  describe("persistence", () => {
    it("persists to disk on save", () => {
      store.record("debugging", "ctx");
      store.save();
      const raw = readFileSync(storePath, "utf-8");
      const data = JSON.parse(raw);
      expect(data["debugging"]).toBeDefined();
      expect(data["debugging"].total_recalls).toBe(1);
    });

    it("loads existing observations from disk", () => {
      store.record("debugging", "ctx");
      store.save();

      const store2 = new ObservationStore(storePath);
      const obs = store2.get("debugging");
      expect(obs).toBeDefined();
      expect(obs!.total_recalls).toBe(1);
    });

    it("handles missing file gracefully", () => {
      const missing = join(dir, "nonexistent.json");
      const store2 = new ObservationStore(missing);
      expect(store2.get("anything")).toBeUndefined();
    });
  });

  describe("scoring", () => {
    it("calculates promotion score", () => {
      // score = total_recalls * log2(distinct_days + 1) * context_diversity * recency_weight
      // With 5 recalls, 3 distinct days, 3 unique contexts out of 5:
      // = 5 * log2(4) * (3/5) * recency_weight
      // = 5 * 2 * 0.6 * ~1.0 = ~6.0
      store.record("debugging", "ctx-a");
      store.record("debugging", "ctx-b");
      store.record("debugging", "ctx-c");
      store.record("debugging", "ctx-a");
      store.record("debugging", "ctx-b");

      // Manually set distinct_days to simulate multiple days
      const obs = store.get("debugging")!;
      obs.distinct_days = 3;

      const score = store.score("debugging");
      expect(score).toBeGreaterThan(0);
      // sqrt(5) * log2(4) * (1 + 0.5*log2(3)) * recency ~= 8.0
      expect(score).toBeCloseTo(8.0, 0);
    });

    it("returns 0 for unknown concept", () => {
      expect(store.score("unknown")).toBe(0);
    });
  });

  describe("promotion check", () => {
    it("identifies concepts above threshold", () => {
      // Build up a concept with high score
      for (let i = 0; i < 10; i++) {
        store.record("core-value", `ctx-${i % 5}`);
      }
      const obs = store.get("core-value")!;
      obs.distinct_days = 7;

      const promoted = store.getPromotable(5.0);
      expect(promoted.some((p) => p.concept === "core-value")).toBe(true);
    });

    it("excludes already-promoted concepts", () => {
      for (let i = 0; i < 10; i++) {
        store.record("core-value", `ctx-${i % 5}`);
      }
      const obs = store.get("core-value")!;
      obs.distinct_days = 7;
      obs.promoted = true;

      const promoted = store.getPromotable(5.0);
      expect(promoted.some((p) => p.concept === "core-value")).toBe(false);
    });
  });

  describe("markPromoted", () => {
    it("marks concept as promoted", () => {
      store.record("core-value", "ctx");
      store.markPromoted("core-value");
      expect(store.get("core-value")!.promoted).toBe(true);
    });
  });

  describe("pruneStale", () => {
    it("removes single-recall concepts older than cutoff", () => {
      store.record("old-noise", "ctx");
      store.get("old-noise")!.last_seen = "2025-01-01";
      store.record("recent", "ctx");
      // recent is today, old-noise is > 30 days ago

      const pruned = store.pruneStale(30);
      expect(pruned).toBe(1);
      expect(store.get("old-noise")).toBeUndefined();
      expect(store.get("recent")).toBeDefined();
    });

    it("keeps multi-recall concepts even if old", () => {
      store.record("recurring", "ctx-a");
      store.record("recurring", "ctx-b");
      store.get("recurring")!.last_seen = "2025-01-01";

      const pruned = store.pruneStale(30);
      expect(pruned).toBe(0);
      expect(store.get("recurring")).toBeDefined();
    });

    it("keeps promoted concepts even if single-recall and old", () => {
      store.record("promoted-once", "ctx");
      store.get("promoted-once")!.last_seen = "2025-01-01";
      store.get("promoted-once")!.promoted = true;

      const pruned = store.pruneStale(30);
      expect(pruned).toBe(0);
      expect(store.get("promoted-once")).toBeDefined();
    });
  });

  describe("incrementDay", () => {
    it("increments distinct_days when called on a new day", () => {
      store.record("debugging", "ctx");
      const before = store.get("debugging")!.distinct_days;
      store.incrementDay("debugging");
      expect(store.get("debugging")!.distinct_days).toBe(before + 1);
    });
  });

  describe("all", () => {
    it("returns all observations", () => {
      store.record("a", "ctx");
      store.record("b", "ctx");
      const all = store.all();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all["a"]).toBeDefined();
      expect(all["b"]).toBeDefined();
    });
  });

  describe("corrupted data recovery", () => {
    it("recovers from backup when observations.json is corrupted", () => {
      // First save: creates the file
      store.record("important-concept", "real-context");
      store.save();

      // Second save: creates .bak from previous version
      store.record("extra-concept", "extra-context");
      store.save();

      // Corrupt the primary file
      writeFileSync(storePath, "{{{{not valid json at all");

      // Create a new store from the corrupted file
      const recovered = new ObservationStore(storePath);
      const obs = recovered.get("important-concept");

      // Should recover from backup (first save version)
      expect(obs).toBeDefined();
      expect(obs!.total_recalls).toBe(1);
    });

    it("returns empty store when both primary and backup are corrupted", () => {
      store.record("concept", "ctx");
      store.save();
      store.record("concept2", "ctx2");
      store.save();

      // Corrupt both files
      writeFileSync(storePath, "not json");
      writeFileSync(storePath + ".bak", "also not json");

      const recovered = new ObservationStore(storePath);
      expect(recovered.get("concept")).toBeUndefined();
      expect(Object.keys(recovered.all())).toHaveLength(0);
    });

    it("creates backup file on save", () => {
      store.record("concept", "ctx");
      store.save();

      const backupPath = storePath + ".bak";
      // After second save, backup of first version should exist
      store.record("concept2", "ctx2");
      store.save();

      const backup = JSON.parse(readFileSync(backupPath, "utf-8"));
      expect(backup["concept"]).toBeDefined();
    });
  });
});
