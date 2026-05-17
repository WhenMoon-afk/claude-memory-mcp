import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { readProjectConfig } from "./project-config.js";

const APP_NAME = "claude-memory";

export function getContinuityDataDir(): string {
  const explicit = process.env["CLAUDE_MEMORY_DATA_DIR"];
  if (explicit) return explicit;

  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg) return join(xdg, APP_NAME);

  const appdata = process.env["APPDATA"];
  if (appdata) return join(appdata, APP_NAME);

  const home = process.env["HOME"] ?? homedir();
  return join(home, ".local", "share", APP_NAME);
}

export function getContinuityDbPath(cwd = process.cwd()): string {
  const explicit = process.env["CLAUDE_MEMORY_DB_PATH"];
  if (explicit) return explicit;

  if (process.env["CLAUDE_MEMORY_DATA_DIR"]) {
    return join(getContinuityDataDir(), "continuity.db");
  }

  const projectDbPath = readProjectConfig(cwd)?.db_path;
  if (projectDbPath) {
    return isAbsolute(projectDbPath) ? projectDbPath : resolve(cwd, projectDbPath);
  }

  return join(getContinuityDataDir(), "continuity.db");
}
