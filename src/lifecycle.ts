import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  createClientRegistrationAdapter,
  defaultCommandRunner,
  type ClientOptions,
  type ClientName,
  type ClientRegistrationAdapter,
  type CommandRunner,
  type RegistrationDiagnostics,
} from "./clients.js";
import { MoonciteEngine, type EngineOptions, type MoonciteStatus } from "./engine.js";
import { MOONCITE_PACKAGE_NAME, MOONCITE_STATE_MARKER_CONTENT, MOONCITE_STATE_MARKER_NAME, MOONCITE_VERSION } from "./identity.js";

const OWNED_STATE_FILES: Record<string, true> = {
  [MOONCITE_STATE_MARKER_NAME]: true,
  "index.sqlite": true,
  "index.sqlite-journal": true,
  "index.sqlite-shm": true,
  "index.sqlite-wal": true,
};
const REGISTRATION_OWNER_FILE = ".mooncite-registrations.json";
const CLIENT_NAMES: readonly ClientName[] = ["pi", "omp", "codex", "claudeCode"];

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

async function assertSafeOwnedDirectory(path: string, label: string): Promise<void> {
  await assertNoSymlinkComponents(path);
  const absolutePath = resolve(path);
  if (await realpath(absolutePath) !== absolutePath) throw new Error(`Refusing aliased ${label} directory.`);
  const state = await lstat(absolutePath, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error(`Refusing non-directory ${label} path.`);
  if (typeof process.getuid === "function") {
    if (state.uid !== BigInt(process.getuid())) throw new Error(`Refusing ${label} directory not owned by the current user.`);
    if ((Number(state.mode) & 0o022) !== 0) throw new Error(`Refusing writable-by-others ${label} directory.`);
    const parent = await lstat(dirname(absolutePath), { bigint: true });
    const parentMode = Number(parent.mode);
    if (!parent.isDirectory() || parent.isSymbolicLink() || ((parentMode & 0o022) !== 0 && (parentMode & 0o1000) === 0)) {
      throw new Error(`Refusing ${label} directory with an unsafe parent.`);
    }
  }
}

async function assertOwnedInstallTree(root: string): Promise<void> {
  const absoluteRoot = resolve(root);
  const canonicalRoot = await realpath(absoluteRoot);
  if (canonicalRoot !== absoluteRoot) throw new Error("Refusing an aliased Mooncite installation.");
  let entriesSeen = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      entriesSeen++;
      if (entriesSeen > 50_000) throw new Error("Refusing an unexpectedly large Mooncite installation tree.");
      const path = join(directory, entry.name);
      const state = await lstat(path, { bigint: true });
      if (typeof process.getuid === "function" && state.uid !== BigInt(process.getuid())) {
        throw new Error("Refusing a Mooncite installation entry not owned by the current user.");
      }
      if (state.isSymbolicLink()) {
        const target = await realpath(path);
        if (!target.startsWith(`${canonicalRoot}${sep}`)) throw new Error("Refusing a Mooncite installation symlink outside the installation root.");
        continue;
      }
      if (state.isDirectory()) await visit(path);
      else if (!state.isFile()) throw new Error("Refusing a non-regular Mooncite installation entry.");
    }
  };
  await visit(canonicalRoot);
}

interface OwnedStateIdentity {
  dev: bigint;
  ino: bigint;
}

async function assertOwnedStateDirectory(path: string, expected?: OwnedStateIdentity): Promise<OwnedStateIdentity> {
  await assertNoSymlinkComponents(path);
  const state = await lstat(path, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Refusing a non-directory Mooncite state path.");
  if (typeof process.getuid === "function") {
    if (state.uid !== BigInt(process.getuid())) throw new Error("Refusing a Mooncite state directory not owned by the current user.");
    if ((Number(state.mode) & 0o077) !== 0) throw new Error("Refusing a non-private Mooncite state directory.");
    const parent = await lstat(dirname(resolve(path)), { bigint: true });
    const parentMode = Number(parent.mode);
    if (!parent.isDirectory() || parent.isSymbolicLink() || ((parentMode & 0o022) !== 0 && (parentMode & 0o1000) === 0)) {
      throw new Error("Refusing a Mooncite state directory with an unsafe parent.");
    }
  }
  const identity = { dev: state.dev, ino: state.ino };
  if (expected && (identity.dev !== expected.dev || identity.ino !== expected.ino)) {
    throw new Error("Refusing a Mooncite state directory that changed identity.");
  }
  return identity;
}

async function assertOwnedStateFile(path: string): Promise<void> {
  const state = await lstat(path, { bigint: true });
  if (state.isSymbolicLink() || !state.isFile() || state.nlink !== 1n) {
    throw new Error(`Refusing non-owned Mooncite state entry: ${path}`);
  }
  if (typeof process.getuid === "function"
    && (state.uid !== BigInt(process.getuid()) || (Number(state.mode) & 0o077) !== 0)) {
    throw new Error(`Refusing Mooncite state entry not privately owned by the current user: ${path}`);
  }
}

async function assertStateMarker(path: string): Promise<void> {
  try {
    await assertOwnedStateFile(path);
  } catch (error) {
    throw new Error("Refusing a missing or invalid Mooncite state marker.", { cause: error });
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const state = await handle.stat({ bigint: true });
    if (!state.isFile() || state.nlink !== 1n
      || (typeof process.getuid === "function" && state.uid !== BigInt(process.getuid()))) {
      throw new Error("Refusing an invalid Mooncite state marker.");
    }
    if (await handle.readFile("utf8") !== MOONCITE_STATE_MARKER_CONTENT) {
      throw new Error("Refusing an invalid Mooncite state marker.");
    }
  } finally {
    await handle.close();
  }
}

function pathsOverlap(left: string, right: string): boolean {
  const canonicalLeft = resolve(left);
  const canonicalRight = resolve(right);
  return canonicalLeft === canonicalRight
    || canonicalLeft.startsWith(`${canonicalRight}${sep}`)
    || canonicalRight.startsWith(`${canonicalLeft}${sep}`);
}

function processIsAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
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

async function readRegistrationOwners(options: InstallationOptions): Promise<ClientName[] | null> {
  const path = join(options.installRoot, REGISTRATION_OWNER_FILE);
  if (await pathKind(path) === "missing") return null;
  await assertOwnedStateFile(path);
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Mooncite registration ownership record is invalid.");
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !Array.isArray(record.clients)
    || record.clients.some((client) => !CLIENT_NAMES.includes(client as ClientName))
    || new Set(record.clients).size !== record.clients.length) {
    throw new Error("Mooncite registration ownership record is invalid.");
  }
  return record.clients as ClientName[];
}

async function writeRegistrationOwners(options: InstallationOptions, clients: readonly ClientName[]): Promise<void> {
  await assertSafeOwnedDirectory(options.installRoot, "Mooncite installation");
  const path = join(options.installRoot, REGISTRATION_OWNER_FILE);
  if (await pathKind(path) !== "missing") await assertOwnedStateFile(path);
  const temporary = join(options.installRoot, `.mooncite-registrations-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, clients: [...clients].sort() })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await assertOwnedStateFile(path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function assertOwnedInstallation(options: InstallationOptions): Promise<void> {
  assertLayout(options);
  await assertSafeOwnedDirectory(options.dataHome, "Mooncite data");
  await assertSafeOwnedDirectory(options.installRoot, "Mooncite installation");
  await assertSafeOwnedDirectory(options.packageRoot, "Mooncite package");
  await assertOwnedInstallTree(options.installRoot);
  const manifestPath = join(options.packageRoot, "package.json");
  const canonicalManifest = await realpath(manifestPath);
  if (!canonicalManifest.startsWith(`${resolve(options.packageRoot)}${sep}`)) {
    throw new Error("Refusing a Mooncite manifest outside the package root.");
  }
  const manifest = await readManifest(canonicalManifest);
  if (manifest?.name !== MOONCITE_PACKAGE_NAME || manifest.version !== MOONCITE_VERSION) {
    throw new Error("Refusing an unrecognized or different-version installation at the Mooncite install path.");
  }
  if (await pathKind(options.cliPath) !== "file") throw new Error("Mooncite stable CLI is missing or not a regular file.");
  const canonicalCli = await realpath(options.cliPath);
  if (!canonicalCli.startsWith(`${resolve(options.packageRoot)}${sep}`)) {
    throw new Error("Refusing a Mooncite CLI outside the package root.");
  }
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
    await chmod(join(targetRoot, "node_modules"), 0o700);
    await chmod(join(targetRoot, "node_modules", "@whenmoon-afk"), 0o700);
    await chmod(join(targetRoot, "node_modules", "@whenmoon-afk", "mooncite"), 0o700);
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
  await assertSafeOwnedDirectory(options.dataHome, "Mooncite data");
  const adapter = registrations ?? createClientRegistrationAdapter(options, runner);
  const registrationPreflight = await adapter.diagnose();
  const conflicts = Object.entries(registrationPreflight).filter(([, state]) => state === "conflict");
  if (conflicts.length) {
    throw new Error(`Refusing conflicting Mooncite client registration: ${conflicts.map(([client]) => client).join(", ")}.`);
  }
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
  await assertOwnedInstallation(options);
  const priorOwners = await readRegistrationOwners(options) ?? [];
  try {
    const status = openStatus(options);
    const configured = await adapter.configure();
    const ownedClients = [...new Set([
      ...priorOwners,
      ...CLIENT_NAMES.filter((client) => configured[client] === "exact"),
    ])];
    await writeRegistrationOwners(options, ownedClients);
    return { outcome, version: MOONCITE_VERSION, status, registrations: configured };
  } catch (error) {
    if (fresh) {
      try {
        await assertOwnedInstallation(options);
        const afterFailure = await adapter.diagnose();
        const unresolved = Object.entries(afterFailure)
          .filter(([client, state]) => registrationPreflight[client as keyof RegistrationDiagnostics] !== state);
        if (unresolved.length) {
          throw new Error(`Registration rollback could not be verified for: ${unresolved.map(([client, state]) => `${client}=${state}`).join(", ")}.`);
        }
        await assertOwnedInstallation(options);
        await rm(options.installRoot, { recursive: true });
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "Mooncite installation failed and the package was retained because registration rollback was incomplete.");
      }
    }
    throw error;
  }
}

export async function disableMooncite(
  options: InstallationOptions,
  runner: CommandRunner = defaultCommandRunner,
  registrations: ClientRegistrationAdapter = createClientRegistrationAdapter(options, runner),
): Promise<{ outcome: "disabled"; registrations: RegistrationDiagnostics }> {
  await assertOwnedInstallation(options);
  const owners = await readRegistrationOwners(options);
  if (!owners) throw new Error("Mooncite registration ownership record is missing; run install to repair it.");
  const diagnostics = await registrations.disable(owners);
  const unresolved = owners.filter((client) => diagnostics[client] !== "missing");
  if (unresolved.length) {
    throw new Error(`Refusing to forget owned client registrations with unverified cleanup: ${unresolved.join(", ")}.`);
  }
  await writeRegistrationOwners(options, []);
  return { outcome: "disabled", registrations: diagnostics };
}

export async function uninstallMooncite(
  options: InstallationOptions,
  runner: CommandRunner = defaultCommandRunner,
  registrations: ClientRegistrationAdapter = createClientRegistrationAdapter(options, runner),
): Promise<{ outcome: "uninstalled"; retainedState: string; registrations: RegistrationDiagnostics }> {
  const kind = await pathKind(options.installRoot);
  if (kind === "missing") throw new Error("Mooncite installation is missing.");
  await assertOwnedInstallation(options);
  const owners = await readRegistrationOwners(options);
  if (!owners) throw new Error("Mooncite registration ownership record is missing; run install to repair it.");
  const before = await registrations.diagnose();
  const unavailable = owners.filter((client) => before[client] === "unavailable");
  if (unavailable.length) {
    throw new Error(`Refusing to remove Mooncite while an owned client registration state is unavailable: ${unavailable.join(", ")}.`);
  }
  const diagnostics = await registrations.disable(owners);
  const unresolved = owners.filter((client) => diagnostics[client] !== "missing");
  if (unresolved.length) {
    throw new Error(`Refusing to remove Mooncite while owned client registration cleanup is unverified: ${unresolved.join(", ")}.`);
  }
  await assertOwnedInstallation(options);
  await rm(options.installRoot, { recursive: true });
  return { outcome: "uninstalled", retainedState: resolve(options.stateDir), registrations: diagnostics };
}

export async function purgeMooncite(
  options: Pick<EngineOptions, "stateDir" | "sessionsRoot" | "ompSessionsRoot" | "optionalSources" | "optionalSourcesProvider">,
  confirmed: boolean,
): Promise<{ outcome: "confirmation_required" | "purged"; ownedPaths: string[] }> {
  const optionalSources = options.optionalSourcesProvider?.() ?? options.optionalSources ?? [];
  const sourceRoots = [
    options.sessionsRoot,
    ...(options.ompSessionsRoot ? [options.ompSessionsRoot] : []),
    ...optionalSources.map((source) => source.root),
  ];
  if (sourceRoots.some((root) => pathsOverlap(root, options.stateDir))) {
    throw new Error("Refusing to purge overlapping Mooncite source and derived-state paths.");
  }
  await assertNoSymlinkComponents(options.stateDir);
  const kind = await pathKind(options.stateDir);
  if (kind === "missing") return { outcome: confirmed ? "purged" : "confirmation_required", ownedPaths: [] };
  if (kind !== "directory") throw new Error("Refusing to purge a non-directory Mooncite state path.");
  const identity = await assertOwnedStateDirectory(options.stateDir);
  await assertStateMarker(join(options.stateDir, MOONCITE_STATE_MARKER_NAME));
  const purgeLock = join(options.stateDir, ".purge.lock");
  try {
    await writeFile(purgeLock, `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await assertOwnedStateFile(purgeLock);
    const ownerPid = Number((await readFile(purgeLock, "utf8")).trim());
    if (processIsAlive(ownerPid)) throw new Error("Refusing to purge while another Mooncite purge is active.");
    await rm(purgeLock);
    await writeFile(purgeLock, `${process.pid}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }
  let purgeLockHeld = true;
  try {
    await assertOwnedStateDirectory(options.stateDir, identity);
    const initialEntries = await readdir(options.stateDir, { withFileTypes: true });
    for (const entry of initialEntries) {
      const match = /^\.engine-(\d+)-[0-9a-f-]+\.lock$/u.exec(entry.name);
      if (!match) continue;
      const path = join(options.stateDir, entry.name);
      await assertOwnedStateFile(path);
      if (processIsAlive(Number(match[1]))) {
        throw new Error("Refusing to purge Mooncite while a live engine is using its evidence index.");
      }
      await rm(path);
    }
    const entries = (await readdir(options.stateDir, { withFileTypes: true }))
      .filter((entry) => entry.name !== ".purge.lock");
    for (const entry of entries) {
      if (!OWNED_STATE_FILES[entry.name] || entry.isSymbolicLink() || !entry.isFile()) {
        throw new Error(`Refusing unknown Mooncite state entry: ${entry.name}`);
      }
      await assertOwnedStateFile(join(options.stateDir, entry.name));
    }
    const ownedPaths = entries.map((entry) => join(options.stateDir, entry.name)).sort((left, right) => {
      if (left.endsWith(`${sep}${MOONCITE_STATE_MARKER_NAME}`)) return 1;
      if (right.endsWith(`${sep}${MOONCITE_STATE_MARKER_NAME}`)) return -1;
      return left.localeCompare(right);
    });
    if (!confirmed) return { outcome: "confirmation_required", ownedPaths };
    for (const path of ownedPaths) {
      await assertOwnedStateDirectory(options.stateDir, identity);
      await assertOwnedStateFile(path);
      await rm(path);
    }
    await assertOwnedStateDirectory(options.stateDir, identity);
    await rm(purgeLock);
    purgeLockHeld = false;
    await rmdir(options.stateDir);
    return { outcome: "purged", ownedPaths };
  } finally {
    if (purgeLockHeld) await rm(purgeLock, { force: true });
  }
}

export function relativeInstallPath(options: InstallationOptions, path: string): string {
  return relative(options.installRoot, path);
}
