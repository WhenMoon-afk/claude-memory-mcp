import { CONTINUITY_SCHEMA_VERSION } from "./db.js";
import type { ContinuityExportEnvelope } from "./types.js";

const ARTIFACT_TYPES = new Set<string>([
  "snapshot",
  "decision",
  "project_state",
  "bundle",
  "meta_snapshot",
]);
const NODE_KINDS = new Set<string>([
  "project",
  "theme",
  "entity",
]);
const RENDER_MODES = new Set<string>(["raw", "prompt", "bridge", "bundle"]);

function assertRecord(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid continuity export: ${path} must be an object.`);
  }
}

function assertString(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new Error(`Invalid continuity export: ${path} must be a string.`);
  }
  return value;
}

function assertNonEmptyString(value: unknown, path: string): string {
  const text = assertString(value, path);
  if (text.length === 0) {
    throw new Error(`Invalid continuity export: ${path} must not be empty.`);
  }
  return text;
}

function assertNullableString(value: unknown, path: string): string | null {
  if (value === null) return null;
  return assertString(value, path);
}

function assertNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid continuity export: ${path} must be a finite number.`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || typeof value !== "number" || value < 1) {
    throw new Error(`Invalid continuity export: ${path} must be a positive integer.`);
  }
  return value;
}

function assertStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`Invalid continuity export: ${path} must be an array of strings.`);
  }

  for (const item of value) {
    if (typeof item !== "string") {
      throw new Error(
        `Invalid continuity export: ${path} must be an array of strings.`,
      );
    }
  }

  return value;
}

function assertEnum(value: unknown, path: string, allowed: Set<string>): string {
  const text = assertNonEmptyString(value, path);
  if (!allowed.has(text)) {
    throw new Error(`Invalid continuity export: ${path} has unsupported value.`);
  }
  return text;
}

function assertUnique<T>(value: T, seen: Set<T>, path: string): void {
  if (seen.has(value)) {
    throw new Error(`Invalid continuity export: ${path} is duplicated.`);
  }
  seen.add(value);
}

function assertReference(
  value: string,
  allowed: Set<string>,
  path: string,
  target: string,
): void {
  if (!allowed.has(value)) {
    throw new Error(
      `Invalid continuity export: ${path} references missing ${target}.`,
    );
  }
}

export function validateExportContents(input: ContinuityExportEnvelope): void {
  if (input.schema_version !== CONTINUITY_SCHEMA_VERSION) {
    throw new Error("Unsupported continuity schema version.");
  }

  const artifactIds = new Set<string>();
  const artifactSeqs = new Set<number>();
  const nodeIds = new Set<string>();
  const nodeKeys = new Set<string>();
  const artifactEdgeKeys = new Set<string>();
  const nodeEdgeKeys = new Set<string>();
  const renderKeys = new Set<string>();

  input.artifacts.forEach((artifact, index) => {
    const path = `artifacts[${index}]`;
    assertRecord(artifact, path);
    const seq = assertPositiveInteger(artifact.seq, `${path}.seq`);
    const id = assertNonEmptyString(artifact.id, `${path}.id`);
    assertEnum(artifact.type, `${path}.type`, ARTIFACT_TYPES);
    assertString(artifact.title, `${path}.title`);
    assertString(artifact.label, `${path}.label`);
    assertString(artifact.preview, `${path}.preview`);
    assertString(artifact.summary, `${path}.summary`);
    assertRecord(artifact.body, `${path}.body`);
    assertNullableString(artifact.project_id, `${path}.project_id`);
    assertStringArray(artifact.next_steps, `${path}.next_steps`);
    assertStringArray(artifact.source_refs, `${path}.source_refs`);
    assertString(artifact.created_at, `${path}.created_at`);
    assertString(artifact.updated_at, `${path}.updated_at`);
    assertUnique(seq, artifactSeqs, `${path}.seq`);
    assertUnique(id, artifactIds, `${path}.id`);
  });

  input.nodes.forEach((node, index) => {
    const path = `nodes[${index}]`;
    assertRecord(node, path);
    const id = assertNonEmptyString(node.id, `${path}.id`);
    assertEnum(node.kind, `${path}.kind`, NODE_KINDS);
    const key = assertNonEmptyString(node.key, `${path}.key`);
    assertString(node.label, `${path}.label`);
    assertString(node.preview, `${path}.preview`);
    assertRecord(node.metadata, `${path}.metadata`);
    assertUnique(id, nodeIds, `${path}.id`);
    assertUnique(key, nodeKeys, `${path}.key`);
  });

  input.artifact_edges.forEach((edge, index) => {
    const path = `artifact_edges[${index}]`;
    assertRecord(edge, path);
    const from = assertNonEmptyString(
      edge.from_artifact_id,
      `${path}.from_artifact_id`,
    );
    const to = assertNonEmptyString(
      edge.to_artifact_id,
      `${path}.to_artifact_id`,
    );
    const relation = assertNonEmptyString(
      edge.relation_type,
      `${path}.relation_type`,
    );
    assertNumber(edge.weight, `${path}.weight`);
    assertReference(from, artifactIds, `${path}.from_artifact_id`, "artifact");
    assertReference(to, artifactIds, `${path}.to_artifact_id`, "artifact");
    assertUnique(`${from}\0${to}\0${relation}`, artifactEdgeKeys, path);
  });

  input.node_edges.forEach((edge, index) => {
    const path = `node_edges[${index}]`;
    assertRecord(edge, path);
    const artifactId = assertNonEmptyString(
      edge.artifact_id,
      `${path}.artifact_id`,
    );
    const nodeId = assertNonEmptyString(edge.node_id, `${path}.node_id`);
    const relation = assertNonEmptyString(
      edge.relation_type,
      `${path}.relation_type`,
    );
    assertNumber(edge.weight, `${path}.weight`);
    assertReference(artifactId, artifactIds, `${path}.artifact_id`, "artifact");
    assertReference(nodeId, nodeIds, `${path}.node_id`, "node");
    assertUnique(`${artifactId}\0${nodeId}\0${relation}`, nodeEdgeKeys, path);
  });

  input.renders.forEach((render, index) => {
    const path = `renders[${index}]`;
    assertRecord(render, path);
    const artifactId = assertNonEmptyString(
      render.artifact_id,
      `${path}.artifact_id`,
    );
    const mode = assertEnum(render.mode, `${path}.mode`, RENDER_MODES);
    assertString(render.content, `${path}.content`);
    assertString(render.generated_at, `${path}.generated_at`);
    assertReference(artifactId, artifactIds, `${path}.artifact_id`, "artifact");
    assertUnique(`${artifactId}\0${mode}`, renderKeys, path);
  });
}
