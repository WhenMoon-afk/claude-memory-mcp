import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProjectConfig {
  project_id?: string;
  project_label?: string;
  db_path?: string;
}

export function readProjectConfig(cwd: string): ProjectConfig | null {
  const path = join(cwd, ".claude-memory.json");
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    throw new Error(`Invalid project config: ${path} must contain valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const value = parsed as Record<string, unknown>;
  const config: ProjectConfig = {};

  if (typeof value["project_id"] === "string") {
    config.project_id = value["project_id"];
  }
  if (typeof value["project_label"] === "string") {
    config.project_label = value["project_label"];
  }
  if (typeof value["db_path"] === "string") {
    config.db_path = value["db_path"];
  }

  return config;
}
