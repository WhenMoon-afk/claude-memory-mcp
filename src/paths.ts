import { join } from "node:path";
import { homedir } from "node:os";

const APP_NAME = "claude-memory";

export function getDataDir(): string {
  // Explicit override — use as-is (no APP_NAME suffix)
  const explicit = process.env["IDENTITY_DATA_DIR"];
  if (explicit) return explicit;

  const xdg = process.env["XDG_DATA_HOME"];
  if (xdg) return join(xdg, APP_NAME);

  const appdata = process.env["APPDATA"];
  if (appdata) return join(appdata, APP_NAME);

  const home = process.env["HOME"] ?? homedir();
  return join(home, ".local", "share", APP_NAME);
}

export function getObservationsPath(): string {
  return join(getDataDir(), "observations.json");
}

export function getIdentityDir(): string {
  return join(getDataDir(), "identity");
}
