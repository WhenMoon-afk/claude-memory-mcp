#!/usr/bin/env node
/**
 * SessionStart hook — outputs identity context summary.
 * Called by hooks.json on session startup/resume.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, "..");

// Resolve data directory (same logic as paths.ts)
function getDataDir() {
  if (process.env.IDENTITY_DATA_DIR) return process.env.IDENTITY_DATA_DIR;

  const platform = process.platform;
  if (platform === "win32" && process.env.APPDATA) {
    return join(process.env.APPDATA, "claude-memory");
  }

  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg || join(process.env.HOME || "~", ".local", "share");
  return join(base, "claude-memory");
}

function readFileSafe(path) {
  try {
    return existsSync(path) ? readFileSync(path, "utf-8").trim() : "";
  } catch {
    return "";
  }
}

try {
  const dataDir = getDataDir();
  const identityDir = join(dataDir, "identity");

  const soul = readFileSafe(join(identityDir, "soul.md"));
  const selfState = readFileSafe(join(identityDir, "self-state.md"));
  const anchors = readFileSafe(join(identityDir, "identity-anchors.md"));

  const hasContent = soul || selfState || anchors;

  if (hasContent) {
    const parts = [];
    if (soul) parts.push(`## Soul\n${soul}`);
    if (anchors) parts.push(`## Identity Anchors\n${anchors}`);
    if (selfState) parts.push(`## Recent Self-State\n${selfState}`);
    console.log(parts.join("\n\n"));
  }
} catch {
  // Silently fail — identity context is optional
}
