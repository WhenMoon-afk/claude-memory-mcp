import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { existsSync, cpSync, mkdirSync } from "node:fs";

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

/**
 * Migrate data from legacy path if needed.
 * v4.1.x on Windows used HOME/.local/share/claude-memory because APPDATA
 * wasn't checked. v4.2.0+ uses APPDATA/claude-memory. This function copies
 * legacy data to the new path on first run after upgrade.
 */
export function migrateIfNeeded(): void {
  // Skip if explicit override — user manages their own path
  if (process.env["IDENTITY_DATA_DIR"]) return;

  const dataDir = getDataDir();

  // If new path already exists, no migration needed
  if (existsSync(dataDir)) return;

  // Check legacy path: HOME/.local/share/claude-memory
  const home = process.env["HOME"] ?? process.env["USERPROFILE"] ?? homedir();
  const legacyDir = join(home, ".local", "share", APP_NAME);

  // Only migrate if legacy path is different from current AND has data
  if (legacyDir === dataDir) return;
  if (!existsSync(legacyDir)) return;

  try {
    mkdirSync(dirname(dataDir), { recursive: true });
    cpSync(legacyDir, dataDir, { recursive: true });
    process.stderr.write(
      `identity: migrated data from ${legacyDir} to ${dataDir}\n`,
    );
  } catch {
    // Migration is best-effort — don't crash if it fails
    process.stderr.write(
      `identity: warning — found legacy data at ${legacyDir} but migration to ${dataDir} failed. Copy manually.\n`,
    );
  }
}

export function getObservationsPath(): string {
  return join(getDataDir(), "observations.json");
}

export function getIdentityDir(): string {
  return join(getDataDir(), "identity");
}
