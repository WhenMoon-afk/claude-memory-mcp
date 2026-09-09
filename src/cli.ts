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
import {
  LearnedMemoryStore,
  learnedMemoryDatabaseRetained,
  loadLearnedMemoryMode,
  resolveLearnedMemoryConfigPath,
  setLearnedMemoryEnabled,
  unavailableLearnedMemoryStatus,
} from "./learned-memory.js";
import { createMoonciteMcpServer } from "./mcp.js";
import {
  addSourceRegistration,
  discoverAutomaticSourceRegistrations,
  isOptionalSourceOrigin,
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
const HELP_TEXT = "Mooncite commands: install, status, rebuild, source list, source add, source remove, memory enable, memory disable, memory status, disable, uninstall, purge, serve\n";

type CliRegistrations = ReturnType<typeof createClientRegistrationAdapter>;

interface CliContext {
  args: string[];
  engineOptions: EngineOptions;
  installation: InstallationOptions;
  registrations: CliRegistrations;
}

type CliCommandHandler = (context: CliContext) => Promise<void>;

function runSourceCommand(args: string[]): void {
  const action = args[1] ?? "list";
  const configPath = resolveSourceConfigPath();
  if (action === "list") {
    const sources = resolveSourceRegistrations();
    writeResult({
      automatic: sources.filter((source) => source.discovery === "automatic"),
      configured: sources.filter((source) => source.discovery !== "automatic"),
      sources,
    });
    return;
  }
  if (action !== "add" && action !== "remove") throw new Error("Usage: mooncite source <list|add|remove>");
  const origin = args[2];
  if (!origin || !isOptionalSourceOrigin(origin)) throw new Error("Mooncite source origin must be claude-code, codex, or chatgpt.");
  const root = args[3];
  if (!root) {
    throw new Error(`Usage: mooncite source ${action} <claude-code|codex|chatgpt> <absolute-root>`);
  }
  const result = action === "add"
    ? addSourceRegistration(configPath, { origin, root })
    : removeSourceRegistration(configPath, { origin, root });
  writeResult(result);
}

async function runServeCommand({ engineOptions, registrations }: CliContext): Promise<void> {
  const handle = serveStdio(
    () => createMoonciteMcpServer(
      engineOptions,
      () => registrations.diagnose(),
      { configPath: resolveLearnedMemoryConfigPath() },
    ),
  );
  await new Promise<void>((resolve) => {
    const finish = (): void => resolve();
    process.stdin.once("end", finish);
    process.stdin.once("close", finish);
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
  await handle.close();
}

async function runMemoryCommand({ args, engineOptions }: CliContext): Promise<void> {
  if (args.length !== 2 || !["enable", "disable", "status"].includes(args[1]!)) {
    throw new Error("Usage: mooncite memory <enable|disable|status>");
  }
  const action = args[1]!;
  const configPath = resolveLearnedMemoryConfigPath();
  if (action === "enable" || action === "disable") {
    const databaseRetained = learnedMemoryDatabaseRetained(engineOptions.stateDir);
    const mode = setLearnedMemoryEnabled(configPath, action === "enable");
    writeResult({
      kind: "derived_memory_config",
      ...mode,
      databaseRetained,
      reloadRequired: true,
    });
    return;
  }
  const mode = loadLearnedMemoryMode(configPath);
  if (!mode.enabled) {
    writeResult({
      kind: "derived_memory_config",
      ...mode,
      databaseRetained: learnedMemoryDatabaseRetained(engineOptions.stateDir),
      reloadRequired: false,
    });
    return;
  }
  const engine = new MoonciteEngine(engineOptions);
  let store: LearnedMemoryStore | null = null;
  try {
    try {
      store = new LearnedMemoryStore(engine, { stateDir: engineOptions.stateDir });
      writeResult({ ...mode, ...store.status(), reloadRequired: false });
    } catch (error) {
      writeResult({ ...mode, ...unavailableLearnedMemoryStatus(error), reloadRequired: false });
    }
  } finally {
    try {
      store?.close();
    } finally {
      engine.close();
    }
  }
}

async function runStatusCommand({ engineOptions, registrations }: CliContext): Promise<void> {
  const engine = new MoonciteEngine(engineOptions);
  let store: LearnedMemoryStore | null = null;
  try {
    const status: Record<string, unknown> = { ...engine.status(), registrations: await registrations.diagnose() };
    try {
      if (loadLearnedMemoryMode(resolveLearnedMemoryConfigPath()).enabled) {
        try {
          store = new LearnedMemoryStore(engine, { stateDir: engineOptions.stateDir });
          status.learnedMemory = store.status();
        } catch (error) {
          status.learnedMemory = unavailableLearnedMemoryStatus(error);
        }
      }
    } catch {
      // Optional learned-memory configuration failures do not alter evidence status.
    }
    writeResult(status);
  } finally {
    try {
      store?.close();
    } finally {
      engine.close();
    }
  }
}

async function runRebuildCommand({ engineOptions }: CliContext): Promise<void> {
  const engine = new MoonciteEngine(engineOptions);
  try {
    writeResult(engine.rebuild());
  } finally {
    engine.close();
  }
}

const COMMAND_HANDLERS: Readonly<Partial<Record<string, CliCommandHandler>>> = {
  serve: runServeCommand,
  memory: runMemoryCommand,
  install: async ({ installation }) => writeResult(await installMooncite(installation)),
  disable: async ({ installation }) => writeResult(await disableMooncite(installation)),
  uninstall: async ({ installation }) => writeResult(await uninstallMooncite(installation)),
  purge: async ({ args, engineOptions }) => {
    const result = await purgeMooncite(engineOptions, args.includes("--yes"));
    writeResult(result);
    if (result.outcome === "confirmation_required") process.exitCode = 2;
  },
  status: runStatusCommand,
  rebuild: runRebuildCommand,
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";
  if (["help", "--help", "-h"].includes(command) || args.slice(1).some((arg) => arg === "--help" || arg === "-h")) {
    process.stdout.write(HELP_TEXT);
    return;
  }
  if (command === "source") {
    runSourceCommand(args);
    return;
  }
  const engineOptions = resolveEngineOptions();
  const installation = resolveInstallationOptions();
  const registrations = createClientRegistrationAdapter(installation);
  const handler = COMMAND_HANDLERS[command];
  if (!handler) throw new Error(`Unknown Mooncite command: ${command}`);
  await handler({ args, engineOptions, installation, registrations });
}

main().catch((error: unknown) => {
  process.stderr.write(`mooncite: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
