#!/usr/bin/env node
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createClientRegistrationAdapter } from "./clients.js";
import { MoonciteEngine, type EngineOptions } from "./engine.js";
import { MOONCITE_INSTALL_DIRECTORY, MOONCITE_STATE_DIRECTORY } from "./identity.js";
import {
  disableMooncite,
  installMooncite,
  purgeMooncite,
  uninstallMooncite,
  type InstallationOptions,
} from "./lifecycle.js";
import { createMoonciteMcpServer } from "./mcp.js";
import {
  addSourceRegistration,
  discoverAutomaticSourceRegistrations,
  isOptionalSourceOrigin,
  loadSourceRegistrations,
  removeSourceRegistration,
  resolveSourceRegistrations as resolveConfiguredSources,
  type SourceRegistration,
} from "./source-config.js";

export function resolveAutomaticSourceRegistrations(env: NodeJS.ProcessEnv = process.env): SourceRegistration[] {
  return discoverAutomaticSourceRegistrations(env);
}

export function resolveSourceRegistrations(env: NodeJS.ProcessEnv = process.env): SourceRegistration[] {
  return resolveConfiguredSources(resolveSourceConfigPath(env), env);
}

export function resolveEngineOptions(env: NodeJS.ProcessEnv = process.env): EngineOptions {
  const home = resolve(env.HOME || homedir());
  const piAgentDir = resolve(env.PI_AGENT_DIR || join(home, ".pi", "agent"));
  const ompAgentDir = resolve(env.PI_CODING_AGENT_DIR || join(home, ".omp", "agent"));
  const stateHome = resolve(env.XDG_STATE_HOME || join(home, ".local", "state"));
  return {
    sessionsRoot: resolve(join(piAgentDir, "sessions")),
    ompSessionsRoot: resolve(join(ompAgentDir, "sessions")),
    optionalSourcesProvider: () => resolveSourceRegistrations(env),
    stateDir: resolve(join(stateHome, MOONCITE_STATE_DIRECTORY)),
  };
}

export function resolveSourceConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const home = resolve(env.HOME || homedir());
  const configHome = resolve(env.XDG_CONFIG_HOME || join(home, ".config"));
  return resolve(join(configHome, "mooncite", "sources.json"));
}

export function resolveInstallationOptions(env: NodeJS.ProcessEnv = process.env): InstallationOptions {
  const home = resolve(env.HOME || homedir());
  const piAgentDir = resolve(env.PI_AGENT_DIR || join(home, ".pi", "agent"));
  const dataHome = resolve(env.XDG_DATA_HOME || join(home, ".local", "share"));
  const installRoot = resolve(join(dataHome, MOONCITE_INSTALL_DIRECTORY));
  const packageRoot = resolve(join(installRoot, "node_modules", "@whenmoon-afk", "mooncite"));
  const currentCliPath = fileURLToPath(import.meta.url);
  const sourcePackageRoot = resolve(dirname(currentCliPath), "..");
  return {
    ...resolveEngineOptions(env),
    home,
    piAgentDir,
    dataHome,
    installRoot,
    sourcePackageRoot,
    packageRoot,
    cliPath: join(packageRoot, "dist", "cli.js"),
    nodePath: process.execPath,
    ...(env.MOONCITE_NPM_COMMAND ? { npmCommand: env.MOONCITE_NPM_COMMAND } : {}),
    ...(env.MOONCITE_PI_COMMAND ? { piCommand: env.MOONCITE_PI_COMMAND } : {}),
    ...(env.MOONCITE_OMP_COMMAND ? { ompCommand: env.MOONCITE_OMP_COMMAND } : {}),
    ...(env.MOONCITE_CODEX_COMMAND ? { codexCommand: env.MOONCITE_CODEX_COMMAND } : {}),
    ...(env.MOONCITE_CLAUDE_COMMAND ? { claudeCommand: env.MOONCITE_CLAUDE_COMMAND } : {}),
  };
}

function writeResult(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "serve";
  if (command === "source") {
    const action = process.argv[3] ?? "list";
    const configPath = resolveSourceConfigPath();
    if (action === "list") {
      const configured = loadSourceRegistrations(configPath);
      writeResult({
        automatic: resolveAutomaticSourceRegistrations().filter((source) => !configured.some((item) => item.origin === source.origin)),
        configured,
        sources: resolveSourceRegistrations(),
      });
      return;
    }
    const origin = process.argv[4];
    if (!origin || !isOptionalSourceOrigin(origin)) throw new Error("Mooncite source origin must be claude-code, codex, or chatgpt.");
    if (action === "add") {
      const root = process.argv[5];
      if (!root) throw new Error("Usage: mooncite source add <claude-code|codex|chatgpt> <absolute-root>");
      writeResult(addSourceRegistration(configPath, { origin, root }));
      return;
    }
    if (action === "remove") {
      writeResult(removeSourceRegistration(configPath, origin));
      return;
    }
    throw new Error("Usage: mooncite source <list|add|remove>");
  }
  const engineOptions = resolveEngineOptions();
  const installation = resolveInstallationOptions();
  const registrations = createClientRegistrationAdapter(installation);

  if (command === "serve") {
    serveStdio(
      () => createMoonciteMcpServer(engineOptions, () => registrations.diagnose()),
      { onerror: (error) => process.stderr.write(`mooncite: ${error.message}\n`) },
    );
    return;
  }
  if (command === "install") {
    writeResult(await installMooncite(installation));
    return;
  }
  if (command === "disable") {
    writeResult(await disableMooncite(installation));
    return;
  }
  if (command === "uninstall") {
    writeResult(await uninstallMooncite(installation));
    return;
  }
  if (command === "purge") {
    const result = await purgeMooncite(engineOptions, process.argv.includes("--yes"));
    writeResult(result);
    if (result.outcome === "confirmation_required") process.exitCode = 2;
    return;
  }
  if (command === "status") {
    const engine = new MoonciteEngine(engineOptions);
    try {
      writeResult({ ...engine.status(), registrations: await registrations.diagnose() });
    } finally {
      engine.close();
    }
    return;
  }
  if (command === "rebuild") {
    const engine = new MoonciteEngine(engineOptions);
    try {
      writeResult(engine.rebuild());
    } finally {
      engine.close();
    }
    return;
  }
  if (["help", "--help", "-h"].includes(command)) {
    process.stdout.write("Mooncite commands: install, status, rebuild, source list, source add, source remove, disable, uninstall, purge, serve\n");
    return;
  }
  throw new Error(`Unknown Mooncite command: ${command}`);
}

main().catch((error: unknown) => {
  process.stderr.write(`mooncite: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
