import {
  CONTINUITY_SCHEMA_VERSION,
  openContinuityDb,
} from "./db.js";
import { makeArtifactId } from "./ids.js";
import { validateExportContents } from "./import-validation.js";
import {
  renderBridge,
  renderBundle,
  renderPrompt,
  renderRaw,
  type RenderMode,
} from "./render.js";
import { compactLabel, compactPreview, normalizeText } from "./text.js";
import type {
  ArtifactEdge,
  ArtifactRender,
  CompactArtifactRow,
  ContinuityArtifact,
  ContinuityExportEnvelope,
  DoctorReport,
  ExportNode,
  GraphNode,
  ImportResult,
  NodeKind,
  NodeEdge,
  RelatedArtifactRow,
  SaveArtifactInput,
} from "./types.js";

type ArtifactRow = {
  seq: number;
  id: string;
  type: ContinuityArtifact["type"];
  title: string;
  label: string;
  preview: string;
  summary: string;
  body_json: string;
  project_id: string | null;
  next_steps_json: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
};

type NodeRow = {
  id: string;
  kind: NodeKind;
  key: string;
  label: string;
  preview: string;
  metadata_json: string;
};

function hydrateArtifact(row: ArtifactRow): ContinuityArtifact {
  return {
    seq: row.seq,
    id: row.id,
    type: row.type,
    title: row.title,
    label: row.label,
    preview: row.preview,
    summary: row.summary,
    body: JSON.parse(row.body_json) as Record<string, unknown>,
    project_id: row.project_id,
    next_steps: JSON.parse(row.next_steps_json) as string[],
    source_refs: JSON.parse(row.source_refs_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function hydrateNode(row: NodeRow): ExportNode {
  return {
    id: row.id,
    kind: row.kind,
    key: row.key,
    label: row.label,
    preview: row.preview,
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
  };
}

function normalizeProjectId(project?: string | null): string | null {
  if (!project) return null;
  const normalized = normalizeText(project);
  return normalized.startsWith("project:")
    ? normalized
    : `project:${normalized}`;
}

function normalizeNodeKey(kind: NodeKind, value: string): string {
  return `${kind}:${normalizeText(value)}`;
}

function assertArray(value: unknown, key: string): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid continuity export: ${key} must be an array.`);
  }
}

function assertExportEnvelope(
  value: unknown,
): asserts value is ContinuityExportEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid continuity export: root must be an object.");
  }
}

export class ContinuityStore {
  private readonly db: ReturnType<typeof openContinuityDb>;

  constructor(path: string) {
    this.db = openContinuityDb(path);
  }

  private upsertNode(kind: NodeKind, value: string): string {
    const normalizedValue = normalizeText(value);
    const nodeId = normalizeNodeKey(kind, normalizedValue);
    this.db
      .prepare(
        `INSERT OR REPLACE INTO nodes (
          id,
          kind,
          key,
          label,
          preview,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)` ,
      )
      .run(
        nodeId,
        kind,
        nodeId,
        normalizedValue,
        `${kind} ${normalizedValue}`,
        JSON.stringify({}),
      );

    return nodeId;
  }

  private linkArtifactNode(
    artifactId: string,
    nodeId: string,
    relationType: string,
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifact_node_edges (
          artifact_id,
          node_id,
          relation_type,
          weight
        ) VALUES (?, ?, ?, 1.0)`,
      )
      .run(artifactId, nodeId, relationType);
  }

  private getSchemaVersion(): number {
    const row = this.db
      .prepare(
        `SELECT value
         FROM store_metadata
         WHERE key = 'schema_version'`,
      )
      .get() as { value: string } | undefined;

    return Number(row?.value ?? CONTINUITY_SCHEMA_VERSION);
  }

  private listAllArtifacts(): ContinuityArtifact[] {
    return (
      this.db
        .prepare(
          `SELECT *
           FROM artifacts
           ORDER BY seq ASC`,
        )
        .all() as ArtifactRow[]
    ).map((row) => hydrateArtifact(row));
  }

  private listAllNodes(): ExportNode[] {
    return (
      this.db
        .prepare(
          `SELECT id, kind, key, label, preview, metadata_json
           FROM nodes
           ORDER BY id ASC`,
        )
        .all() as NodeRow[]
    ).map((row) => hydrateNode(row));
  }

  private clearStoreData(): void {
    this.db.prepare("DELETE FROM artifact_renders").run();
    this.db.prepare("DELETE FROM artifact_artifact_edges").run();
    this.db.prepare("DELETE FROM artifact_node_edges").run();
    this.db.prepare("DELETE FROM nodes").run();
    this.db.prepare("DELETE FROM artifacts").run();
  }

  saveArtifact(input: SaveArtifactInput): ContinuityArtifact {
    const now = new Date().toISOString();
    const seq = (
      this.db
        .prepare("SELECT IFNULL(MAX(seq), 0) + 1 AS seq FROM artifacts")
        .get() as { seq: number }
    ).seq;
    const normalizedTitle = normalizeText(input.title);
    const normalizedSummary = normalizeText(input.summary);
    const id = makeArtifactId(input.type, seq);
    const projectId = normalizeProjectId(input.project);

    this.db
      .prepare(
        `INSERT INTO artifacts (
          seq,
          id,
          type,
          title,
          label,
          preview,
          summary,
          body_json,
          project_id,
          subject_kind,
          subject_id,
          next_steps_json,
          source_refs_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        seq,
        id,
        input.type,
        normalizedTitle,
        compactLabel(normalizedTitle),
        compactPreview(normalizedSummary),
        normalizedSummary,
        JSON.stringify(input.body ?? {}),
        projectId,
        null,
        null,
        JSON.stringify(input.next_steps ?? []),
        JSON.stringify([]),
        now,
        now,
      );

    const record = this.getArtifact(id)!;
    const raw = renderRaw(record);
    const prompt = renderPrompt(record);
    const bridge = renderBridge(record, []);
    const bundle = renderBundle(record, []);
    const insertRender = this.db.prepare(
      `INSERT OR REPLACE INTO artifact_renders (
        artifact_id,
        mode,
        content,
        generated_at
      ) VALUES (?, ?, ?, ?)`,
    );

    insertRender.run(record.id, "raw", raw, now);
    insertRender.run(record.id, "prompt", prompt, now);
    insertRender.run(record.id, "bridge", bridge, now);
    insertRender.run(record.id, "bundle", bundle, now);

    if (projectId) {
      const projectNodeId = this.upsertNode("project", projectId.replace(/^project:/, ""));
      this.linkArtifactNode(record.id, projectNodeId, "about_project");
    }

    for (const theme of input.themes ?? []) {
      const themeNodeId = this.upsertNode("theme", theme);
      this.linkArtifactNode(record.id, themeNodeId, "about_theme");
    }

    for (const entity of input.entities ?? []) {
      const entityNodeId = this.upsertNode("entity", entity);
      this.linkArtifactNode(record.id, entityNodeId, "about_entity");
    }

    return record;
  }

  getArtifact(id: string): ContinuityArtifact | null {
    const row = this.db
      .prepare("SELECT * FROM artifacts WHERE id = ?")
      .get(id) as ArtifactRow | undefined;

    return row ? hydrateArtifact(row) : null;
  }

  listArtifacts(projectId?: string): CompactArtifactRow[] {
    const normalizedProjectId = normalizeProjectId(projectId);

    return this.db
      .prepare(
        `SELECT id, type, label, preview, project_id
         FROM artifacts
         WHERE (? IS NULL OR project_id = ?)
         ORDER BY updated_at DESC, seq DESC
         LIMIT 50`,
      )
      .all(normalizedProjectId, normalizedProjectId) as CompactArtifactRow[];
  }

  searchArtifacts(query: string): CompactArtifactRow[] {
    const normalizedQuery = normalizeText(query);
    if (normalizedQuery === "") return [];
    const ftsQuery = `"${normalizedQuery.replace(/"/g, '""')}"`;
    const likeQuery = `%${normalizedQuery.toLowerCase()}%`;

    return this.db
      .prepare(
        `SELECT DISTINCT a.id, a.type, a.label, a.preview, a.project_id
         FROM artifacts a
         WHERE a.seq IN (
           SELECT rowid
           FROM artifacts_fts
           WHERE artifacts_fts MATCH ?
           UNION
           SELECT linked.seq
           FROM nodes n
           JOIN artifact_node_edges e ON e.node_id = n.id
           JOIN artifacts linked ON linked.id = e.artifact_id
           WHERE lower(n.label) LIKE ?
              OR lower(n.key) LIKE ?
              OR lower(n.preview) LIKE ?
         )
         ORDER BY a.updated_at DESC, a.seq DESC
         LIMIT 20`,
      )
      .all(ftsQuery, likeQuery, likeQuery, likeQuery) as CompactArtifactRow[];
  }

  getArtifactDetail(id: string): Omit<ContinuityArtifact, "seq" | "body" | "source_refs" | "created_at"> | null {
    const row = this.db
      .prepare(
        `SELECT id, type, title, label, preview, summary, project_id, next_steps_json, updated_at
         FROM artifacts
         WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          type: ContinuityArtifact["type"];
          title: string;
          label: string;
          preview: string;
          summary: string;
          project_id: string | null;
          next_steps_json: string;
          updated_at: string;
        }
      | undefined;

    if (!row) return null;

    return {
      id: row.id,
      type: row.type,
      title: row.title,
      label: row.label,
      preview: row.preview,
      summary: row.summary,
      project_id: row.project_id,
      next_steps: JSON.parse(row.next_steps_json) as string[],
      updated_at: row.updated_at,
    };
  }

  getNearbyArtifacts(id: string, limit: number = 5): CompactArtifactRow[] {
    const artifact = this.getArtifact(id);
    if (!artifact) return [];

    return this.db
      .prepare(
        `SELECT id, type, label, preview, project_id
         FROM artifacts
         WHERE id != ?
           AND (? IS NULL OR project_id = ?)
         ORDER BY updated_at DESC, seq DESC
         LIMIT ?`,
      )
      .all(id, artifact.project_id, artifact.project_id, limit) as CompactArtifactRow[];
  }

  getNode(id: string): GraphNode | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, label, preview
         FROM nodes
         WHERE id = ?`,
      )
      .get(id) as GraphNode | undefined;

    return row ?? null;
  }

  getNodeArtifacts(nodeId: string, limit: number = 10): CompactArtifactRow[] {
    return this.db
      .prepare(
        `SELECT a.id, a.type, a.label, a.preview, a.project_id
         FROM artifact_node_edges e
         JOIN artifacts a ON a.id = e.artifact_id
         WHERE e.node_id = ?
         GROUP BY a.id, a.type, a.label, a.preview, a.project_id, a.updated_at, a.seq
         ORDER BY a.updated_at DESC, a.seq DESC
         LIMIT ?`,
      )
      .all(nodeId, limit) as CompactArtifactRow[];
  }

  getRelatedArtifacts(
    id: string,
    via: "nodes" | "edges" | "all" = "all",
    limit: number = 10,
  ): RelatedArtifactRow[] {
    const rows = new Map<string, RelatedArtifactRow>();

    const upsertRelated = (
      row: CompactArtifactRow,
      reasons: string[],
    ): void => {
      const existing = rows.get(row.id);
      if (existing) {
        existing.reasons = [...new Set([...existing.reasons, ...reasons])];
        return;
      }

      rows.set(row.id, {
        ...row,
        reasons: [...new Set(reasons)],
      });
    };

    if (via === "nodes" || via === "all") {
      const nodeRows = this.db
        .prepare(
          `SELECT
             a.id,
             a.type,
             a.label,
             a.preview,
             a.project_id,
             GROUP_CONCAT(DISTINCT n.id) AS shared_node_ids
           FROM artifact_node_edges base
           JOIN artifact_node_edges related
             ON related.node_id = base.node_id
            AND related.artifact_id != base.artifact_id
           JOIN nodes n ON n.id = base.node_id
           JOIN artifacts a ON a.id = related.artifact_id
           WHERE base.artifact_id = ?
           GROUP BY a.id, a.type, a.label, a.preview, a.project_id, a.updated_at, a.seq
           ORDER BY COUNT(DISTINCT n.id) DESC, a.updated_at DESC, a.seq DESC
           LIMIT ?`,
        )
        .all(id, limit) as Array<
        CompactArtifactRow & { shared_node_ids: string | null }
      >;

      for (const row of nodeRows) {
        const reasons = (row.shared_node_ids ?? "")
          .split(",")
          .filter((value) => value !== "")
          .map((value) => `shared ${value}`);
        upsertRelated(row, reasons);
      }
    }

    if (via === "edges" || via === "all") {
      const edgeRows = this.db
        .prepare(
          `SELECT
             a.id,
             a.type,
             a.label,
             a.preview,
             a.project_id,
             GROUP_CONCAT(DISTINCT e.relation_type) AS relation_types
           FROM artifact_artifact_edges e
           JOIN artifacts a
             ON a.id = CASE
               WHEN e.from_artifact_id = ? THEN e.to_artifact_id
               ELSE e.from_artifact_id
             END
           WHERE e.from_artifact_id = ? OR e.to_artifact_id = ?
           GROUP BY a.id, a.type, a.label, a.preview, a.project_id, a.updated_at, a.seq
           ORDER BY a.updated_at DESC, a.seq DESC
           LIMIT ?`,
        )
        .all(id, id, id, limit) as Array<
        CompactArtifactRow & { relation_types: string | null }
      >;

      for (const row of edgeRows) {
        const reasons = (row.relation_types ?? "")
          .split(",")
          .filter((value) => value !== "")
          .map((value) => `edge ${value}`);
        upsertRelated(row, reasons);
      }
    }

    return [...rows.values()].sort((left, right) => {
      if (right.reasons.length !== left.reasons.length) {
        return right.reasons.length - left.reasons.length;
      }

      return left.id.localeCompare(right.id);
    }).slice(0, limit);
  }

  getDoctorReport(): DoctorReport {
    const getCount = (table: string): number => {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS count FROM ${table}`)
        .get() as { count: number };
      return row.count;
    };

    const integrityRow = this.db
      .prepare("PRAGMA integrity_check")
      .get() as { integrity_check: string } | undefined;

    return {
      schema_version: this.getSchemaVersion(),
      integrity: integrityRow?.integrity_check ?? "unknown",
      counts: {
        artifacts: getCount("artifacts"),
        nodes: getCount("nodes"),
        artifact_edges: getCount("artifact_artifact_edges"),
        node_edges: getCount("artifact_node_edges"),
        renders: getCount("artifact_renders"),
      },
    };
  }

  exportData(): ContinuityExportEnvelope {
    const artifactEdges = this.db
      .prepare(
        `SELECT from_artifact_id, to_artifact_id, relation_type, weight
         FROM artifact_artifact_edges
         ORDER BY from_artifact_id ASC, to_artifact_id ASC, relation_type ASC`,
      )
      .all() as ArtifactEdge[];

    const nodeEdges = this.db
      .prepare(
        `SELECT artifact_id, node_id, relation_type, weight
         FROM artifact_node_edges
         ORDER BY artifact_id ASC, node_id ASC, relation_type ASC`,
      )
      .all() as NodeEdge[];

    const renders = this.db
      .prepare(
        `SELECT artifact_id, mode, content, generated_at
         FROM artifact_renders
         ORDER BY artifact_id ASC, mode ASC`,
      )
      .all() as ArtifactRender[];

    return {
      format: "claude-memory-continuity-export",
      version: 1,
      schema_version: this.getSchemaVersion(),
      exported_at: new Date().toISOString(),
      artifacts: this.listAllArtifacts(),
      nodes: this.listAllNodes(),
      artifact_edges: artifactEdges,
      node_edges: nodeEdges,
      renders,
    };
  }

  importData(
    input: unknown,
    options: { dryRun?: boolean } = {},
  ): ImportResult {
    assertExportEnvelope(input);

    if (input.format !== "claude-memory-continuity-export" || input.version !== 1) {
      throw new Error("Unsupported continuity export format.");
    }

    assertArray(input.artifacts, "artifacts");
    assertArray(input.nodes, "nodes");
    assertArray(input.artifact_edges, "artifact_edges");
    assertArray(input.node_edges, "node_edges");
    assertArray(input.renders, "renders");
    validateExportContents(input);

    const result: ImportResult = {
      artifact_count: input.artifacts.length,
      node_count: input.nodes.length,
      artifact_edge_count: input.artifact_edges.length,
      node_edge_count: input.node_edges.length,
      render_count: input.renders.length,
      dry_run: options.dryRun ?? false,
    };

    if (options.dryRun) {
      return result;
    }

    const importTransaction = this.db.transaction(() => {
      this.clearStoreData();

      const insertArtifact = this.db.prepare(
        `INSERT INTO artifacts (
          seq,
          id,
          type,
          title,
          label,
          preview,
          summary,
          body_json,
          project_id,
          subject_kind,
          subject_id,
          next_steps_json,
          source_refs_json,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertNode = this.db.prepare(
        `INSERT INTO nodes (
          id,
          kind,
          key,
          label,
          preview,
          metadata_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertArtifactEdge = this.db.prepare(
        `INSERT INTO artifact_artifact_edges (
          from_artifact_id,
          to_artifact_id,
          relation_type,
          weight
        ) VALUES (?, ?, ?, ?)`,
      );
      const insertNodeEdge = this.db.prepare(
        `INSERT INTO artifact_node_edges (
          artifact_id,
          node_id,
          relation_type,
          weight
        ) VALUES (?, ?, ?, ?)`,
      );
      const insertRender = this.db.prepare(
        `INSERT INTO artifact_renders (
          artifact_id,
          mode,
          content,
          generated_at
        ) VALUES (?, ?, ?, ?)`,
      );

      for (const artifact of input.artifacts) {
        insertArtifact.run(
          artifact.seq,
          artifact.id,
          artifact.type,
          artifact.title,
          artifact.label,
          artifact.preview,
          artifact.summary,
          JSON.stringify(artifact.body),
          artifact.project_id,
          null,
          null,
          JSON.stringify(artifact.next_steps),
          JSON.stringify(artifact.source_refs),
          artifact.created_at,
          artifact.updated_at,
        );
      }

      for (const node of input.nodes) {
        insertNode.run(
          node.id,
          node.kind,
          node.key,
          node.label,
          node.preview,
          JSON.stringify(node.metadata),
        );
      }

      for (const edge of input.artifact_edges) {
        insertArtifactEdge.run(
          edge.from_artifact_id,
          edge.to_artifact_id,
          edge.relation_type,
          edge.weight,
        );
      }

      for (const edge of input.node_edges) {
        insertNodeEdge.run(
          edge.artifact_id,
          edge.node_id,
          edge.relation_type,
          edge.weight,
        );
      }

      for (const render of input.renders) {
        insertRender.run(
          render.artifact_id,
          render.mode,
          render.content,
          render.generated_at,
        );
      }

      this.db
        .prepare(
          `INSERT OR REPLACE INTO store_metadata (key, value)
           VALUES ('schema_version', ?)`,
        )
        .run(String(input.schema_version));
    });

    importTransaction();
    return result;
  }

  private latestByType(
    type: ContinuityArtifact["type"],
    projectId?: string | null,
  ): ContinuityArtifact | null {
    const row = this.db
      .prepare(
        `SELECT *
         FROM artifacts
         WHERE type = ?
           AND (? IS NULL OR project_id = ?)
         ORDER BY updated_at DESC, seq DESC
         LIMIT 1`,
      )
      .get(type, projectId ?? null, projectId ?? null) as ArtifactRow | undefined;

    return row ? hydrateArtifact(row) : null;
  }

  private latestManyByType(
    type: ContinuityArtifact["type"],
    projectId?: string | null,
    limit: number = 5,
  ): ContinuityArtifact[] {
    return (
      this.db
        .prepare(
          `SELECT *
           FROM artifacts
           WHERE type = ?
             AND (? IS NULL OR project_id = ?)
           ORDER BY updated_at DESC, seq DESC
           LIMIT ?`,
        )
        .all(type, projectId ?? null, projectId ?? null, limit) as ArtifactRow[]
    ).map((row) => hydrateArtifact(row));
  }

  buildBundle(project?: string): ContinuityArtifact[] {
    const projectId = normalizeProjectId(project);

    if (!projectId) {
      return this.listArtifacts()
        .slice(0, 5)
        .map((row) => this.getArtifact(row.id))
        .filter((artifact): artifact is ContinuityArtifact => artifact !== null);
    }

    return [
      this.latestByType("project_state", projectId),
      this.latestByType("snapshot", projectId),
      ...this.latestManyByType("decision", projectId, 5),
      this.latestByType("meta_snapshot", projectId),
    ].filter((artifact): artifact is ContinuityArtifact => artifact !== null);
  }

  getNeighbors(id: string, limit: number = 5): CompactArtifactRow[] {
    const combined: CompactArtifactRow[] = [];
    const seen = new Set<string>();

    for (const row of this.getRelatedArtifacts(id, "all", limit)) {
      if (seen.has(row.id)) continue;
      combined.push({
        id: row.id,
        type: row.type,
        label: row.label,
        preview: row.preview,
        project_id: row.project_id,
      });
      seen.add(row.id);
      if (combined.length >= limit) return combined;
    }

    const nearby = this.getNearbyArtifacts(id, limit * 2)
      .filter((row) => !seen.has(row.id))
      .slice(0, limit - combined.length);

    return [...combined, ...nearby];
  }

  getRender(id: string, mode: RenderMode): string | null {
    const row = this.db
      .prepare(
        `SELECT content
         FROM artifact_renders
         WHERE artifact_id = ? AND mode = ?`,
      )
      .get(id, mode) as { content: string } | undefined;

    return row?.content ?? null;
  }

  buildBundleText(project?: string): string {
    const artifacts = this.buildBundle(project);
    if (artifacts.length === 0) return "No continuity artifacts found.";

    const header = project
      ? `Bundle for project: ${normalizeText(project)}`
      : "Bundle for recent continuity";

    return [
      header,
      "",
      ...artifacts.map((artifact) =>
        [
          `${artifact.type}: ${artifact.title}`,
          `Summary: ${artifact.summary}`,
          `Next: ${artifact.next_steps.join("; ") || "none"}`,
        ].join("\n"),
      ),
    ].join("\n\n");
  }

  mergeArtifacts(
    ids: string[],
    type: "bundle" | "meta_snapshot",
    title?: string,
  ): ContinuityArtifact {
    const artifacts = ids
      .map((id) => this.getArtifact(id))
      .filter((artifact): artifact is ContinuityArtifact => artifact !== null);

    if (artifacts.length < 2) {
      throw new Error("Need at least two artifacts to merge.");
    }

    const projectId = artifacts[0]!.project_id ?? null;
    const project = projectId?.replace(/^project:/, "");
    const nextSteps = [...new Set(artifacts.flatMap((artifact) => artifact.next_steps))];
    const sourceIds = artifacts.map((artifact) => artifact.id);

    const mergedInput = {
      type,
      title: title ?? `Merged ${artifacts.length} artifacts`,
      summary: artifacts
        .map((artifact) => `${artifact.type}: ${artifact.summary}`)
        .join(" | "),
      next_steps: nextSteps,
      body: { source_ids: sourceIds },
      ...(project ? { project } : {}),
    } satisfies SaveArtifactInput;

    const merged = this.saveArtifact(mergedInput);
    const edge = this.db.prepare(
      `INSERT OR REPLACE INTO artifact_artifact_edges (
        from_artifact_id,
        to_artifact_id,
        relation_type,
        weight
      ) VALUES (?, ?, 'merges', 1.0)`,
    );

    for (const sourceId of sourceIds) {
      edge.run(merged.id, sourceId);
    }

    return merged;
  }

  deleteArtifact(id: string): boolean {
    this.db
      .prepare(
        `DELETE FROM artifact_artifact_edges
         WHERE from_artifact_id = ? OR to_artifact_id = ?`,
      )
      .run(id, id);
    this.db
      .prepare(
        `DELETE FROM artifact_node_edges
         WHERE artifact_id = ?`,
      )
      .run(id);
    this.db
      .prepare(
        `DELETE FROM artifact_renders
         WHERE artifact_id = ?`,
      )
      .run(id);
    const result = this.db
      .prepare(
        `DELETE FROM artifacts
         WHERE id = ?`,
      )
      .run(id);

    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
