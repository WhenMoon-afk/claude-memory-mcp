import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatchContinuityAction } from "./continuity/actions.js";
import { ContinuityStore } from "./continuity/store.js";
import { createServer } from "./index.js";

describe("integration: continuity workflow", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "integration-test-"));
    dbPath = join(dir, "continuity.db");
    process.env["CLAUDE_MEMORY_DB_PATH"] = dbPath;
  });

  afterEach(() => {
    delete process.env["CLAUDE_MEMORY_DB_PATH"];
    rmSync(dir, { recursive: true, force: true });
  });

  it("opens the continuity database on server creation", () => {
    createServer();
    expect(existsSync(dbPath)).toBe(true);
  });

  it("save → get roundtrip works", async () => {
    const store = new ContinuityStore(dbPath);

    try {
      await dispatchContinuityAction(store, {
        action: "save",
        type: "snapshot",
        title: "JWT auth handoff",
        summary: "JWT middleware is green and password reset is next.",
        project: "notes-api",
        next_steps: ["Implement password reset"],
      });

      const detail = await dispatchContinuityAction(store, {
        action: "get",
        id: "snap-1",
        detail: "full",
      });

      expect(detail.text).toContain("JWT auth handoff");
      expect(detail.text).toContain("Implement password reset");
    } finally {
      store.close();
    }
  });

  it("search and bundle expose compact continuity", async () => {
    const store = new ContinuityStore(dbPath);

    try {
      await dispatchContinuityAction(store, {
        action: "save",
        type: "snapshot",
        title: "JWT auth handoff",
        summary: "JWT middleware is green and password reset is next.",
        project: "notes-api",
      });
      await dispatchContinuityAction(store, {
        action: "save",
        type: "decision",
        title: "Keep SQLite local-first",
        summary: "SQLite keeps the continuity graph inspectable.",
        project: "notes-api",
      });

      const search = await dispatchContinuityAction(store, {
        action: "search",
        query: "auth",
      });
      const bundle = await dispatchContinuityAction(store, {
        action: "bundle",
        project: "notes-api",
      });

      expect(search.text).toContain("snap-1");
      expect(bundle.text).toContain("Bundle for project: notes-api");
      expect(bundle.text).toContain("snapshot: JWT auth handoff");
      expect(bundle.text).toContain("Keep SQLite local-first");
    } finally {
      store.close();
    }
  });

  it("artifacts persist across store instances", () => {
    const store1 = new ContinuityStore(dbPath);
    store1.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff",
      summary: "JWT middleware is green and password reset is next.",
      project: "notes-api",
    });
    store1.close();

    const store2 = new ContinuityStore(dbPath);
    try {
      const artifact = store2.getArtifact("snap-1");
      expect(artifact).toBeDefined();
      expect(artifact!.summary).toContain("password reset");
    } finally {
      store2.close();
    }
  });

  it("merge lifecycle: save → merge → delete", async () => {
    const store = new ContinuityStore(dbPath);

    try {
      await dispatchContinuityAction(store, {
        action: "save",
        type: "snapshot",
        title: "JWT auth handoff",
        summary: "JWT middleware is green and password reset is next.",
        project: "notes-api",
      });
      await dispatchContinuityAction(store, {
        action: "save",
        type: "decision",
        title: "Keep SQLite local-first",
        summary: "SQLite keeps the continuity graph inspectable.",
        project: "notes-api",
      });

      const merged = await dispatchContinuityAction(store, {
        action: "merge",
        ids: ["snap-1", "dec-2"],
        type: "meta_snapshot",
        title: "Auth continuity merge",
      });
      expect(merged.text).toContain("meta-3");

      const deleted = await dispatchContinuityAction(store, {
        action: "delete",
        id: "meta-3",
      });
      expect(deleted.text).toContain("Deleted meta-3");
      expect(store.getArtifact("meta-3")).toBeNull();
    } finally {
      store.close();
    }
  });
});
