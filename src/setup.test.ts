import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateDesktopConfig, getDesktopConfigPath } from "./setup.js";

describe("setup", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "setup-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("generateDesktopConfig", () => {
    it("creates config with memory-mcp server entry", () => {
      const config = generateDesktopConfig();
      expect(config.mcpServers).toBeDefined();
      expect(config.mcpServers["identity"]).toBeDefined();
      expect(config.mcpServers["identity"].command).toBe("npx");
      expect(config.mcpServers["identity"].args).toContain(
        "@whenmoon-afk/memory-mcp",
      );
    });

    it("merges with existing config when provided", () => {
      const existing = {
        mcpServers: {
          "other-server": {
            command: "node",
            args: ["other.js"],
          },
        },
      };
      const config = generateDesktopConfig(existing);
      expect(config.mcpServers["other-server"]).toBeDefined();
      expect(config.mcpServers["identity"]).toBeDefined();
    });

    it("does not overwrite existing memory-mcp entry", () => {
      const existing = {
        mcpServers: {
          identity: {
            command: "custom",
            args: ["custom-path"],
          },
        },
      };
      const config = generateDesktopConfig(existing);
      expect(config.mcpServers["identity"].command).toBe("custom");
    });
  });

  describe("getDesktopConfigPath", () => {
    it("returns platform-appropriate path", () => {
      const path = getDesktopConfigPath();
      expect(path).toContain("claude_desktop_config.json");
    });
  });
});
