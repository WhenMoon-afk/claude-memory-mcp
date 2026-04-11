export type ArtifactType =
  | "snapshot"
  | "decision"
  | "project_state"
  | "bundle"
  | "meta_snapshot";

export type NodeKind =
  | "project"
  | "theme"
  | "entity";

export interface SaveArtifactInput {
  type: ArtifactType;
  title: string;
  summary: string;
  project?: string;
  themes?: string[];
  entities?: string[];
  next_steps?: string[];
  body?: Record<string, unknown>;
}

export interface ContinuityArtifact {
  seq: number;
  id: string;
  type: ArtifactType;
  title: string;
  label: string;
  preview: string;
  summary: string;
  body: Record<string, unknown>;
  project_id: string | null;
  next_steps: string[];
  source_refs: string[];
  created_at: string;
  updated_at: string;
}

export interface CompactArtifactRow {
  id: string;
  type: ArtifactType;
  label: string;
  preview: string;
  project_id: string | null;
}

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  preview: string;
}

export interface RelatedArtifactRow extends CompactArtifactRow {
  reasons: string[];
}

export interface DoctorCounts {
  artifacts: number;
  nodes: number;
  artifact_edges: number;
  node_edges: number;
  renders: number;
}

export interface DoctorReport {
  schema_version: number;
  integrity: string;
  counts: DoctorCounts;
}

export interface ExportNode extends GraphNode {
  key: string;
  metadata: Record<string, unknown>;
}

export interface ArtifactEdge {
  from_artifact_id: string;
  to_artifact_id: string;
  relation_type: string;
  weight: number;
}

export interface NodeEdge {
  artifact_id: string;
  node_id: string;
  relation_type: string;
  weight: number;
}

export interface ArtifactRender {
  artifact_id: string;
  mode: "raw" | "prompt" | "bridge" | "bundle";
  content: string;
  generated_at: string;
}

export interface ContinuityExportEnvelope {
  format: "claude-memory-continuity-export";
  version: 1;
  schema_version: number;
  exported_at: string;
  artifacts: ContinuityArtifact[];
  nodes: ExportNode[];
  artifact_edges: ArtifactEdge[];
  node_edges: NodeEdge[];
  renders: ArtifactRender[];
}

export interface ImportResult {
  artifact_count: number;
  node_count: number;
  artifact_edge_count: number;
  node_edge_count: number;
  render_count: number;
  dry_run: boolean;
}
