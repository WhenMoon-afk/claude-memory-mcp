#!/usr/bin/env node
/**
 * Plugin server wrapper — ensures dependencies are installed and dist is built
 * before starting the MCP server. Used by Claude Code plugin system.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PLUGIN_ROOT = process.env.CLAUDE_PLUGIN_ROOT || join(__dirname, "..");

function runCommand(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? `${cmd}.cmd` : cmd;

    process.stderr.write(`identity: ${label}...\n`);

    const child = spawn(command, args, {
      cwd: PLUGIN_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows,
    });

    child.stdout.on("data", (data) => process.stderr.write(data));
    child.stderr.on("data", (data) => process.stderr.write(data));

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${label} failed (exit ${code})`));
      }
    });

    child.on("error", (err) => reject(err));
  });
}

async function main() {
  const nodeModulesPath = join(PLUGIN_ROOT, "node_modules");
  if (!existsSync(nodeModulesPath)) {
    await runCommand(
      "npm",
      ["install", "--prefer-offline", "--no-audit", "--no-fund"],
      "installing dependencies",
    );
  }

  const serverPath = join(PLUGIN_ROOT, "dist", "index.js");
  if (!existsSync(serverPath)) {
    await runCommand("npm", ["run", "build"], "building");
  }

  const child = spawn(process.execPath, [serverPath], {
    stdio: "inherit",
    shell: false,
  });

  process.on("SIGTERM", () => child.kill("SIGTERM"));
  process.on("SIGINT", () => child.kill("SIGINT"));

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code || 0);
    }
  });

  child.on("error", (err) => {
    process.stderr.write(`identity: failed to start server: ${err.message}\n`);
    process.exit(1);
  });
}

main().catch((err) => {
  process.stderr.write(`identity: ${err.message}\n`);
  process.exit(1);
});
