import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { MOONCITE_MCP_NAME, MOONCITE_PACKAGE_NAME } from "./identity.js";

export type ClientName = "pi" | "omp" | "codex" | "claudeCode";
export type RegistrationState = "missing" | "exact" | "conflict" | "unavailable";
export type RegistrationDiagnostics = Record<ClientName, RegistrationState>;

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<CommandResult>;

export interface ClientOptions {
  home: string;
  piAgentDir: string;
  packageRoot: string;
  cliPath: string;
  nodePath: string;
  piCommand?: string;
  ompCommand?: string;
  codexCommand?: string;
  claudeCommand?: string;
}

export interface ClientRegistrationAdapter {
  diagnose(): Promise<RegistrationDiagnostics>;
  configure(): Promise<RegistrationDiagnostics>;
  disable(): Promise<RegistrationDiagnostics>;
}

export const defaultCommandRunner: CommandRunner = async (command, args, env = process.env) => {
  const { promise, resolve, reject } = Promise.withResolvers<CommandResult>();
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  return promise;
};

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function packageSource(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return typeof (value as Record<string, unknown>).source === "string"
    ? String((value as Record<string, unknown>).source)
    : null;
}

async function piState(options: ClientOptions, runner: CommandRunner, env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const probe = await runner(options.piCommand ?? "pi", ["--version"], env).catch(() => null);
  if (!probe || probe.code !== 0) return "unavailable";
  const settings = await readJson(join(options.piAgentDir, "settings.json"));
  const packages = settings && typeof settings === "object" && Array.isArray((settings as Record<string, unknown>).packages)
    ? (settings as Record<string, unknown>).packages as unknown[]
    : [];
  let exact = 0;
  let conflict = false;
  for (const entry of packages) {
    const source = packageSource(entry);
    if (!source) continue;
    if (resolve(options.piAgentDir, source) === resolve(options.packageRoot)) {
      exact++;
      continue;
    }
    if (source === MOONCITE_PACKAGE_NAME || source.startsWith(`${MOONCITE_PACKAGE_NAME}@`) || source.startsWith(`npm:${MOONCITE_PACKAGE_NAME}`)) conflict = true;
  }
  return conflict || exact > 1 ? "conflict" : exact === 1 ? "exact" : "missing";
}

function walkPluginEntries(value: unknown, output: Array<Record<string, unknown>>): void {
  if (Array.isArray(value)) {
    for (const item of value) walkPluginEntries(item, output);
    return;
  }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string" && typeof record.path === "string") output.push(record);
  for (const child of Object.values(record)) walkPluginEntries(child, output);
}

async function ompState(options: ClientOptions, runner: CommandRunner, env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const result = await runner(options.ompCommand ?? "omp", ["plugin", "list", "--json"], env).catch(() => null);
  if (!result || result.code !== 0) return "unavailable";
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout) as unknown; } catch { return "unavailable"; }
  const entries: Array<Record<string, unknown>> = [];
  walkPluginEntries(parsed, entries);
  const mooncite = entries.filter((entry) => entry.name === MOONCITE_PACKAGE_NAME || entry.name === "mooncite");
  const exact = mooncite.filter((entry) => resolve(String(entry.path)) === resolve(options.packageRoot));
  return mooncite.length === 0 ? "missing" : exact.length === 1 && mooncite.length === 1 ? "exact" : "conflict";
}

async function codexState(options: ClientOptions, runner: CommandRunner, env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const result = await runner(options.codexCommand ?? "codex", ["mcp", "get", MOONCITE_MCP_NAME, "--json"], env).catch(() => null);
  if (!result) return "unavailable";
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    return /not found|no mcp server/iu.test(text) ? "missing" : "unavailable";
  }
  let value: unknown;
  try { value = JSON.parse(result.stdout) as unknown; } catch { return "conflict"; }
  if (!value || typeof value !== "object") return "conflict";
  const record = value as Record<string, unknown>;
  const transport = record.transport && typeof record.transport === "object" ? record.transport as Record<string, unknown> : {};
  const args = Array.isArray(transport.args) ? transport.args : [];
  return record.name === MOONCITE_MCP_NAME && transport.type === "stdio" && transport.command === options.nodePath
    && args.length === 2 && args[0] === options.cliPath && args[1] === "serve"
    ? "exact"
    : "conflict";
}

async function claudeState(options: ClientOptions, runner: CommandRunner, env: NodeJS.ProcessEnv): Promise<RegistrationState> {
  const result = await runner(options.claudeCommand ?? "claude", ["mcp", "get", MOONCITE_MCP_NAME], env).catch(() => null);
  if (!result) return "unavailable";
  if (result.code !== 0) {
    const text = `${result.stdout}\n${result.stderr}`;
    return /not found|no mcp server/iu.test(text) ? "missing" : "unavailable";
  }
  const text = `${result.stdout}\n${result.stderr}`;
  const exact = text.includes(options.nodePath) && text.includes(options.cliPath) && text.includes("serve");
  return exact ? "exact" : "conflict";
}

async function required(runner: CommandRunner, command: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  const result = await runner(command, args, env);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
}

export function createClientRegistrationAdapter(
  options: ClientOptions,
  runner: CommandRunner = defaultCommandRunner,
): ClientRegistrationAdapter {
  const env = { ...process.env, HOME: options.home, PI_AGENT_DIR: options.piAgentDir };
  const diagnose = async (): Promise<RegistrationDiagnostics> => ({
    pi: await piState(options, runner, env),
    omp: await ompState(options, runner, env),
    codex: await codexState(options, runner, env),
    claudeCode: await claudeState(options, runner, env),
  });

  const add = async (client: ClientName): Promise<void> => {
    if (client === "pi") await required(runner, options.piCommand ?? "pi", ["install", options.packageRoot], env);
    else if (client === "omp") await required(runner, options.ompCommand ?? "omp", ["plugin", "link", options.packageRoot], env);
    else if (client === "codex") await required(runner, options.codexCommand ?? "codex", ["mcp", "add", MOONCITE_MCP_NAME, "--", options.nodePath, options.cliPath, "serve"], env);
    else await required(runner, options.claudeCommand ?? "claude", ["mcp", "add", "--scope", "user", MOONCITE_MCP_NAME, "--", options.nodePath, options.cliPath, "serve"], env);
  };
  const remove = async (client: ClientName): Promise<void> => {
    if (client === "pi") await required(runner, options.piCommand ?? "pi", ["remove", options.packageRoot], env);
    else if (client === "omp") await required(runner, options.ompCommand ?? "omp", ["plugin", "uninstall", MOONCITE_PACKAGE_NAME], env);
    else if (client === "codex") await required(runner, options.codexCommand ?? "codex", ["mcp", "remove", MOONCITE_MCP_NAME], env);
    else await required(runner, options.claudeCommand ?? "claude", ["mcp", "remove", "--scope", "user", MOONCITE_MCP_NAME], env);
  };

  return {
    diagnose,
    async configure() {
      const before = await diagnose();
      for (const [client, state] of Object.entries(before) as Array<[ClientName, RegistrationState]>) {
        if (state === "conflict") throw new Error(`Refusing conflicting ${client} registration for Mooncite.`);
      }
      const added: ClientName[] = [];
      try {
        for (const client of ["pi", "omp", "codex", "claudeCode"] as const) {
          if (before[client] !== "missing") continue;
          await add(client);
          added.push(client);
        }
      } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const client of added.reverse()) {
          try { await remove(client); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
        }
        if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "Mooncite registration failed and rollback was incomplete.");
        throw error;
      }
      return diagnose();
    },
    async disable() {
      const before = await diagnose();
      for (const [client, state] of Object.entries(before) as Array<[ClientName, RegistrationState]>) {
        if (state === "conflict") throw new Error(`Refusing to remove conflicting ${client} registration for Mooncite.`);
      }
      for (const client of ["claudeCode", "codex", "omp", "pi"] as const) {
        if (before[client] === "exact") await remove(client);
      }
      return diagnose();
    },
  };
}
