import { join } from "node:path";
import { homedir, platform } from "node:os";

interface ServerConfig {
  command: string;
  args: string[];
}

interface DesktopConfig {
  mcpServers: Record<string, ServerConfig>;
  [key: string]: unknown;
}

const SERVER_NAME = "continuity";
const LEGACY_SERVER_NAME = "identity";
const DEFAULT_SERVER_CONFIG: ServerConfig = {
  command: "npx",
  args: ["-y", "@whenmoon-afk/memory-mcp"],
};

export function generateDesktopConfig(existing?: DesktopConfig): DesktopConfig {
  const base: DesktopConfig = existing
    ? { ...existing, mcpServers: { ...existing.mcpServers } }
    : { mcpServers: {} };

  if (base.mcpServers[SERVER_NAME]) {
    return base;
  }

  const legacy = base.mcpServers[LEGACY_SERVER_NAME];
  if (legacy) {
    base.mcpServers[SERVER_NAME] = {
      command: legacy.command,
      args: [...legacy.args],
    };
    delete base.mcpServers[LEGACY_SERVER_NAME];
    return base;
  }

  base.mcpServers[SERVER_NAME] = {
    command: DEFAULT_SERVER_CONFIG.command,
    args: [...DEFAULT_SERVER_CONFIG.args],
  };

  return base;
}

export function getDesktopConfigPath(): string {
  const os = platform();
  if (os === "darwin") {
    return join(
      homedir(),
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (os === "win32") {
    return join(
      process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"),
      "Claude",
      "claude_desktop_config.json",
    );
  }
  // Linux
  return join(
    process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"),
    "Claude",
    "claude_desktop_config.json",
  );
}
