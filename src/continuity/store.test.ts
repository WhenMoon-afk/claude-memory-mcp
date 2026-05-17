import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ContinuityStore } from "./store.js";

describe("ContinuityStore", () => {
  let dir: string;
  let store: ContinuityStore;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "continuity-store-"));
    store = new ContinuityStore(join(dir, "continuity.db"));
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("saves and retrieves a snapshot artifact", () => {
    const saved = store.saveArtifact({
      type: "snapshot",
      title: "JWT auth pass",
      summary: "JWT middleware works, tests are green",
      project: "notes-api",
      next_steps: ["Add password reset flow"],
      body: { status: "green" },
    });

    expect(saved.id).toBe("snap-1");
    expect(saved.type).toBe("snapshot");
    expect(saved.label).toBe("JWT auth pass");
    expect(saved.preview).toBe("JWT middleware works, tests are green");
    expect(saved.project_id).toBe("project:notes-api");
    expect(saved.next_steps).toEqual(["Add password reset flow"]);
    expect(saved.body).toEqual({ status: "green" });

    const loaded = store.getArtifact(saved.id);

    expect(loaded).toEqual(saved);
  });

  it("lists compact artifacts in saved order", () => {
    const first = store.saveArtifact({
      type: "snapshot",
      title: "JWT auth handoff for mobile clients",
      summary:
        "JWT middleware is stable, mobile token refresh still needs coverage before release.",
      project: "notes-api",
    });

    const second = store.saveArtifact({
      type: "decision",
      title: "Use SQLite for continuity graph",
      summary: "SQLite keeps the storage local-first and inspectable.",
      project: "notes-api",
    });

    expect(first.id).toBe("snap-1");
    expect(second.id).toBe("dec-2");

    const rows = store.listArtifacts();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: second.id,
      type: "decision",
      label: "Use SQLite for cont…",
      preview: "SQLite keeps the storage local-first and inspectable.",
      project_id: "project:notes-api",
    });
    expect(rows[1]).toMatchObject({
      id: first.id,
      type: "snapshot",
      label: "JWT auth handoff fo…",
      project_id: "project:notes-api",
    });
    expect(rows[1]!.preview).toHaveLength(80);
    expect(rows[1]!.preview).toContain("mobile token refresh");
    expect(rows[1]!.preview.endsWith("…")).toBe(true);
    expect(rows[0]).not.toHaveProperty("summary");
    expect(rows[0]).not.toHaveProperty("body");
  });

  it("reports schema metadata and store integrity", () => {
    const report = store.getDoctorReport();

    expect(report.schema_version).toBe(1);
    expect(report.integrity).toBe("ok");
    expect(report.counts).toEqual({
      artifacts: 0,
      nodes: 0,
      artifact_edges: 0,
      node_edges: 0,
      renders: 0,
    });
  });

  it("exports and re-imports continuity data without losing graph links", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "JWT handoff",
      summary: "Refresh flow still needs docs",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    const decision = store.saveArtifact({
      type: "decision",
      title: "Rotate refresh tokens",
      summary: "Refresh tokens rotate on re-authentication",
      project: "notes-api",
      themes: ["authentication"],
      entities: ["jwt"],
    });
    store.mergeArtifacts([snapshot.id, decision.id], "meta_snapshot", "Auth merge");

    const exported = store.exportData();
    const imported = new ContinuityStore(join(dir, "imported.db"));

    imported.importData(exported);

    expect(imported.listArtifacts()).toHaveLength(3);
    expect(imported.getNode("theme:authentication")).not.toBeNull();
    expect(imported.getRelatedArtifacts(snapshot.id, "all")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: decision.id })]),
    );

    imported.close();
  });

  it("keeps exports focused on artifacts, projects, themes, and entities", () => {
    const saved = store.saveArtifact({
      type: "snapshot",
      title: "Simple local memory",
      summary: "Store the handoff as a local continuity artifact.",
      project: "notes-api",
      themes: ["handoff"],
      entities: ["sqlite"],
    });

    const exported = store.exportData();

    expect(exported.artifacts[0]).toEqual(
      expect.objectContaining({
        id: saved.id,
        project_id: "project:notes-api",
      }),
    );
    expect(exported.artifacts[0]).not.toHaveProperty("subject_kind");
    expect(exported.artifacts[0]).not.toHaveProperty("subject_id");
    expect(exported.nodes.map((node) => node.kind).sort()).toEqual([
      "entity",
      "project",
      "theme",
    ]);
  });

  it("validates imports without changing existing data on dry run", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });
    const incoming = store.exportData();
    incoming.artifacts[0] = {
      ...incoming.artifacts[0]!,
      title: "Imported continuity",
      label: "Imported continuity",
    };

    const result = store.importData(incoming, { dryRun: true });

    expect(result).toEqual({
      artifact_count: 1,
      node_count: 0,
      artifact_edge_count: 0,
      node_edge_count: 0,
      render_count: 4,
      dry_run: true,
    });
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects malformed imports before replacing current data", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });

    expect(() =>
      store.importData({
        format: "claude-memory-continuity-export",
        version: 1,
        schema_version: 1,
        exported_at: new Date().toISOString(),
      } as never),
    ).toThrow("Invalid continuity export");

    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects non-object import envelopes before replacing current data", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });

    expect(() => store.importData(null)).toThrow(
      "Invalid continuity export: root must be an object.",
    );
    expect(() => store.importData([])).toThrow(
      "Invalid continuity export: root must be an object.",
    );

    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with invalid artifact fields before dry runs or replacement", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });
    const incoming = store.exportData();
    incoming.artifacts[0] = {
      ...incoming.artifacts[0]!,
      type: "unsafe_instruction" as never,
    };

    expect(() => store.importData(incoming, { dryRun: true })).toThrow(
      "Invalid continuity export: artifacts[0].type",
    );
    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: artifacts[0].type",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with artifact ids that do not match type and seq", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });
    const incoming = store.exportData();
    incoming.artifacts[0] = {
      ...incoming.artifacts[0]!,
      id: "snap-3",
    };

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: artifacts[0].id does not match type and seq.",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with dangling graph references before replacement", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
      themes: ["auth"],
    });
    const incoming = store.exportData();
    incoming.node_edges.push({
      artifact_id: "missing-artifact",
      node_id: "theme:auth",
      relation_type: "about_theme",
      weight: 1,
    });

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: node_edges[1].artifact_id",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with unsupported graph node kinds before replacement", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
      themes: ["auth"],
    });
    const incoming = store.exportData();
    incoming.nodes.push({
      id: "unsupported:example",
      kind: "unsupported" as never,
      key: "unsupported:example",
      label: "example",
      preview: "unsupported example",
      metadata: {},
    });

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: nodes[1].kind",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with graph node ids that do not match their keys", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
      themes: ["auth"],
    });
    const incoming = store.exportData();
    incoming.nodes[0] = {
      ...incoming.nodes[0]!,
      id: "theme:stored",
    };

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: nodes[0].id must match nodes[0].key.",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with graph node ids that do not match their kind prefix", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
      themes: ["auth"],
    });
    const incoming = store.exportData();
    incoming.nodes[0] = {
      ...incoming.nodes[0]!,
      kind: "entity",
    };

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: nodes[0].id must start with entity:.",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("rejects imports with missing export timestamps", () => {
    store.saveArtifact({
      type: "snapshot",
      title: "Existing continuity",
      summary: "Keep this data intact",
    });
    const incoming = store.exportData();
    delete (incoming as Partial<typeof incoming>).exported_at;

    expect(() => store.importData(incoming)).toThrow(
      "Invalid continuity export: exported_at must be a string.",
    );
    expect(store.listArtifacts()).toEqual([
      expect.objectContaining({ id: "snap-1", label: "Existing continuity" }),
    ]);
  });

  it("removes linked graph edges when deleting an artifact", () => {
    const snapshot = store.saveArtifact({
      type: "snapshot",
      title: "JWT handoff",
      summary: "Refresh flow still needs docs",
      project: "notes-api",
      themes: ["authentication"],
    });
    const decision = store.saveArtifact({
      type: "decision",
      title: "Rotate refresh tokens",
      summary: "Refresh tokens rotate on re-authentication",
      project: "notes-api",
      themes: ["authentication"],
    });
    store.mergeArtifacts([snapshot.id, decision.id], "meta_snapshot", "Auth merge");

    expect(store.getRelatedArtifacts(snapshot.id, "all")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: decision.id })]),
    );

    store.deleteArtifact(snapshot.id);

    expect(store.getArtifact(snapshot.id)).toBeNull();
    expect(store.getRelatedArtifacts(decision.id, "all")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: snapshot.id })]),
    );
    expect(store.getDoctorReport().counts.artifact_edges).toBe(1);
  });
});
