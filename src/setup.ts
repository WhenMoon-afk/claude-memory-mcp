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

export function generateDesktopConfig(existing?: DesktopConfig): DesktopConfig {
  const base: DesktopConfig = existing
    ? { ...existing, mcpServers: { ...existing.mcpServers } }
    : { mcpServers: {} };

  if (!base.mcpServers["identity"]) {
    base.mcpServers["identity"] = {
      command: "npx",
      args: ["-y", "@whenmoon-afk/memory-mcp"],
    };
  }

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
