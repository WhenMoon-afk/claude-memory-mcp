import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  createClientRegistrationAdapter,
  defaultCommandRunner,
  type ClientOptions,
  type ClientRegistrationAdapter,
  type CommandRunner,
  type RegistrationDiagnostics,
} from "./clients.js";
import { MoonciteEngine, type EngineOptions, type MoonciteStatus } from "./engine.js";
import { MOONCITE_PACKAGE_NAME, MOONCITE_VERSION } from "./identity.js";

const OWNED_STATE_FILES: Record<string, true> = {
  "index.sqlite": true,
  "index.sqlite-journal": true,
  "index.sqlite-shm": true,
  "index.sqlite-wal": true,
};

export interface InstallationOptions extends EngineOptions, ClientOptions {
  dataHome: string;
  installRoot: string;
  sourcePackageRoot: string;
  npmCommand?: string;
}

export interface InstallResult {
  outcome: "installed" | "already_installed";
  version: string;
  status: MoonciteStatus;
  registrations: RegistrationDiagnostics;
}

export type PackageStager = (targetRoot: string) => Promise<void>;

async function pathKind(path: string): Promise<"missing" | "file" | "directory" | "other"> {
  try {
    const value = await lstat(path);
    if (value.isSymbolicLink()) return "other";
    if (value.isFile()) return "file";
    if (value.isDirectory()) return "directory";
    return "other";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function assertNoSymlinkComponents(path: string): Promise<void> {
  let current = resolve(path);
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symbolic-link path: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = resolve(current, "..");
    if (parent === current) return;
    current = parent;
  }
}

async function readManifest(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function assertLayout(options: InstallationOptions): void {
  const dataHome = resolve(options.dataHome);
  const installRoot = resolve(options.installRoot);
  const packageRoot = resolve(options.packageRoot);
  if (resolve(installRoot, "..") !== dataHome) throw new Error("Mooncite install root must be a direct child of XDG_DATA_HOME.");
  if (!packageRoot.startsWith(`${installRoot}${sep}`)) throw new Error("Mooncite stable package must be inside its installation root.");
  if (resolve(options.cliPath) !== resolve(packageRoot, "dist", "cli.js")) throw new Error("Mooncite stable CLI path does not match its package.");
}

async function assertOwnedInstallation(options: InstallationOptions): Promise<void> {
  assertLayout(options);
  await assertNoSymlinkComponents(options.installRoot);
  if (await pathKind(options.installRoot) !== "directory") throw new Error("Mooncite stable installation is missing or not a regular directory.");
  const manifest = await readManifest(join(options.packageRoot, "package.json"));
  if (manifest?.name !== MOONCITE_PACKAGE_NAME || manifest.version !== MOONCITE_VERSION) {
    throw new Error("Refusing an unrecognized or different-version installation at the Mooncite install path.");
  }
  if (await pathKind(options.cliPath) !== "file") throw new Error("Mooncite stable CLI is missing or not a regular file.");
}

async function required(runner: CommandRunner, command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const result = await runner(command, args, env);
  if (result.code !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim() || `exit ${result.code}`}`);
  return result.stdout;
}

function createPackageStager(options: InstallationOptions, runner: CommandRunner): PackageStager {
  return async (targetRoot) => {
    await mkdir(targetRoot, { recursive: true, mode: 0o700 });
    const stdout = await required(
      runner,
      options.npmCommand ?? "npm",
      ["pack", options.sourcePackageRoot, "--ignore-scripts", "--json", "--pack-destination", targetRoot],
      process.env,
    );
    let packedName: string;
    try {
      const parsed = JSON.parse(stdout) as Array<{ filename?: unknown }>;
      if (!Array.isArray(parsed) || typeof parsed[0]?.filename !== "string") throw new Error("missing filename");
      packedName = parsed[0].filename;
    } catch {
      throw new Error("npm pack did not return a package filename.");
    }
    const archive = resolve(targetRoot, packedName);
    if (!archive.startsWith(`${resolve(targetRoot)}${sep}`)) throw new Error("npm pack returned a path outside the staging root.");
    await required(
      runner,
      options.npmCommand ?? "npm",
      ["install", "--prefix", targetRoot, "--omit=dev", "--ignore-scripts", archive],
      process.env,
    );
    await rm(archive, { force: true });
  };
}

function openStatus(options: EngineOptions): MoonciteStatus {
  const engine = new MoonciteEngine(options);
  try {
    return engine.status();
  } finally {
    engine.close();
  }
}

export async function installMooncite(
  options: InstallationOptions,
  runner: CommandRunner = defaultCommandRunner,
  registrations?: ClientRegistrationAdapter,
  stagePackage: PackageStager = createPackageStager(options, runner),
): Promise<InstallResult> {
  assertLayout(options);
  await assertNoSymlinkComponents(options.dataHome);
  await mkdir(options.dataHome, { recursive: true, mode: 0o700 });
  const existing = await pathKind(options.installRoot);
  let outcome: InstallResult["outcome"] = "already_installed";
  let fresh = false;
  if (existing === "missing") {
    const staging = await mkdtemp(join(options.dataHome, ".mooncite-stage-"));
    try {
      await stagePackage(staging);
      const stagedOptions = {
        ...options,
        installRoot: staging,
        packageRoot: join(staging, "node_modules", "@whenmoon-afk", "mooncite"),
        cliPath: join(staging, "node_modules", "@whenmoon-afk", "mooncite", "dist", "cli.js"),
      };
      await assertOwnedInstallation(stagedOptions);
      await rename(staging, options.installRoot);
      fresh = true;
      outcome = "installed";
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  } else {
    await assertOwnedInstallation(options);
  }

  const adapter = registrations ?? createClientRegistrationAdapter(options, runner);
  try {
    const status = openStatus(options);
    const configured = await adapter.configure();
    return { outcome, version: MOONCITE_VERSION, status, registrations: configured };
  } catch (error) {
    if (fresh) {
      try { await adapter.disable(); } catch { /* Preserve the installation error. */ }
      await assertOwnedInstallation(options);
      await rm(options.installRoot, { recursive: true });
    }
    throw error;
  }
}

export async function disableMooncite(
  options: InstallationOptions,
  runner: CommandRunner = defaultCommandRunner,
  registrations: ClientRegistrationAdapter = createClientRegistrationAdapter(options, runner),
): Promise<{ outcome: "disabled"; registrations: RegistrationDiagnostics }> {
  return { outcome: "disabled", registrations: await registrations.disable() };
}

export async function uninstallMooncite(
  options: InstallationOptions,
  runner: CommandRunner = defaultCommandRunner,
  registrations: ClientRegistrationAdapter = createClientRegistrationAdapter(options, runner),
): Promise<{ outcome: "uninstalled"; retainedState: string; registrations: RegistrationDiagnostics }> {
  const diagnostics = await registrations.disable();
  const kind = await pathKind(options.installRoot);
  if (kind !== "missing") {
    await assertOwnedInstallation(options);
    await rm(options.installRoot, { recursive: true });
  }
  return { outcome: "uninstalled", retainedState: resolve(options.stateDir), registrations: diagnostics };
}

export async function purgeMooncite(
  options: Pick<InstallationOptions, "stateDir" | "sessionsRoot">,
  confirmed: boolean,
): Promise<{ outcome: "confirmation_required" | "purged"; ownedPaths: string[] }> {
  await assertNoSymlinkComponents(options.stateDir);
  const kind = await pathKind(options.stateDir);
  if (kind === "missing") return { outcome: confirmed ? "purged" : "confirmation_required", ownedPaths: [] };
  if (kind !== "directory") throw new Error("Refusing to purge a non-directory Mooncite state path.");
  const entries = await readdir(options.stateDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!OWNED_STATE_FILES[entry.name] || entry.isSymbolicLink() || !entry.isFile()) {
      throw new Error(`Refusing unknown Mooncite state entry: ${entry.name}`);
    }
  }
  const ownedPaths = entries.map((entry) => join(options.stateDir, entry.name)).sort();
  if (!confirmed) return { outcome: "confirmation_required", ownedPaths };
  for (const path of ownedPaths) await rm(path);
  await rmdir(options.stateDir);
  return { outcome: "purged", ownedPaths };
}

export function relativeInstallPath(options: InstallationOptions, path: string): string {
  return relative(options.installRoot, path);
}
