import { homedir } from "node:os";
import { join } from "node:path";

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

export function getContinuityDbPath(): string {
  return process.env["CLAUDE_MEMORY_DB_PATH"] ?? join(getContinuityDataDir(), "continuity.db");
}
