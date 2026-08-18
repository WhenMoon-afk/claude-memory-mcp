import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type OptionalSourceOrigin = "claude-code" | "codex" | "chatgpt";

export interface SourceRegistration {
  origin: OptionalSourceOrigin;
  root: string;
  discovery?: "automatic";
}

interface SourceConfig {
  version: 1;
  sources: SourceRegistration[];
}

const OPTIONAL_SOURCE_ORIGINS = new Set<OptionalSourceOrigin>(["claude-code", "codex", "chatgpt"]);
const MAX_SOURCE_CONFIG_BYTES = 1024 * 1024;

function hasSymlinkComponent(path: string): boolean {
  let current = resolve(path);
  while (true) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function assertSafeAncestorChain(path: string): void {
  if (typeof process.getuid !== "function") return;
  const uid = BigInt(process.getuid());
  const chain: string[] = [];
  let current = resolve(path);
  while (true) {
    chain.push(current);
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  let confined = false;
  for (const component of chain.reverse()) {
    const state = lstatSync(component, { bigint: true });
    if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite source configuration has a non-directory ancestor.");
    if (!confined && state.uid !== 0n && state.uid !== uid) {
      throw new Error("Mooncite source configuration has an untrusted ancestor owner.");
    }
    const mode = Number(state.mode);
    if (confined && state.uid !== uid) throw new Error("Mooncite source configuration escapes its owner-private ancestor.");
    if (!confined && (mode & 0o022) !== 0 && (mode & 0o1000) === 0) {
      throw new Error("Mooncite source configuration has an unsafe writable ancestor.");
    }
    if (state.uid === uid && (mode & 0o011) === 0) confined = true;
  }
}

function assertOwnedConfigDirectory(path: string): void {
  const absolutePath = resolve(path);
  if (hasSymlinkComponent(absolutePath)) throw new Error("Mooncite source configuration path contains a symbolic-link component.");
  const state = lstatSync(absolutePath, { bigint: true });
  if (state.isSymbolicLink() || !state.isDirectory()) throw new Error("Mooncite source configuration directory is not regular.");
  if (typeof process.getuid === "function") {
    if (state.uid !== BigInt(process.getuid())) throw new Error("Mooncite source configuration directory is not owned by the current user.");
    if ((Number(state.mode) & 0o077) !== 0) throw new Error("Mooncite source configuration directory is not private.");
    assertSafeAncestorChain(absolutePath);
  }
}

function validateRoot(root: unknown, requireExisting = false): string {
  if (typeof root !== "string" || !isAbsolute(root) || resolve(root) !== root) {
    throw new Error("Mooncite optional source root must be an absolute normalized path.");
  }
  if (hasSymlinkComponent(root)) throw new Error("Mooncite optional source root contains a symbolic-link component.");
  if (existsSync(root)) {
    if (!lstatSync(root).isDirectory()) throw new Error("Mooncite optional source root is not a regular directory.");
  } else if (requireExisting) {
    throw new Error("Mooncite optional source root must be an existing regular directory.");
  }
  return root;
}

function parseConfig(value: unknown): SourceConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mooncite source configuration is invalid.");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "sources,version" || record.version !== 1 || !Array.isArray(record.sources)) {
    throw new Error("Mooncite source configuration is invalid.");
  }
  const sources: SourceRegistration[] = [];
  const origins = new Set<OptionalSourceOrigin>();
  for (const item of record.sources) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Mooncite source registration is invalid.");
    const source = item as Record<string, unknown>;
    if (Object.keys(source).sort().join(",") !== "origin,root"
      || typeof source.origin !== "string"
      || !OPTIONAL_SOURCE_ORIGINS.has(source.origin as OptionalSourceOrigin)) {
      throw new Error("Mooncite source registration is invalid.");
    }
    const origin = source.origin as OptionalSourceOrigin;
    if (origins.has(origin)) throw new Error(`Mooncite ${origin} source is registered more than once.`);
    origins.add(origin);
    sources.push({ origin, root: validateRoot(source.root) });
  }
  return { version: 1, sources: sources.sort((a, b) => a.origin.localeCompare(b.origin)) };
}

export function loadSourceRegistrations(configPath: string): SourceRegistration[] {
  const path = resolve(configPath);
  if (hasSymlinkComponent(path)) throw new Error("Mooncite source configuration path contains a symbolic-link component.");
  if (!existsSync(path)) return [];
  assertOwnedConfigDirectory(dirname(path));
  const before = lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isFile()) throw new Error("Mooncite source configuration is not a regular file.");
  if (typeof process.getuid === "function" && before.uid !== BigInt(process.getuid())) {
    throw new Error("Mooncite source configuration is not owned by the current user.");
  }
  if ((Number(before.mode) & 0o077) !== 0) throw new Error("Mooncite source configuration is not private.");
  const size = Number(before.size);
  if (!Number.isSafeInteger(size) || size < 0 || size > MAX_SOURCE_CONFIG_BYTES) {
    throw new Error("Mooncite source configuration exceeds the size limit.");
  }
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile()
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.size !== before.size
      || opened.mtimeNs !== before.mtimeNs
      || opened.ctimeNs !== before.ctimeNs) {
      throw new Error("Mooncite source configuration changed identity.");
    }
    bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = readSync(fd, bytes, offset, size - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== size) throw new Error("Mooncite source configuration could not be read completely.");
  } finally {
    closeSync(fd);
  }
  const after = lstatSync(path, { bigint: true });
  if (after.dev !== before.dev
    || after.ino !== before.ino
    || after.size !== before.size
    || after.mtimeNs !== before.mtimeNs
    || after.ctimeNs !== before.ctimeNs) {
    throw new Error("Mooncite source configuration changed while reading.");
  }
  return parseConfig(JSON.parse(bytes.toString("utf8")) as unknown).sources;
}

export function discoverAutomaticSourceRegistrations(env: NodeJS.ProcessEnv = process.env): SourceRegistration[] {
  if (env.MOONCITE_AUTO_SOURCES === "0") return [];
  const home = resolve(env.HOME || homedir());
  const codexHome = resolve(env.CODEX_HOME || join(home, ".codex"));
  return [
    { origin: "claude-code", root: resolve(join(home, ".claude", "projects")), discovery: "automatic" },
    { origin: "claude-code", root: resolve(join(home, ".config", "claude-sol", "projects")), discovery: "automatic" },
    { origin: "codex", root: resolve(join(codexHome, "sessions")), discovery: "automatic" },
    { origin: "chatgpt", root: resolve(join(home, "incoming", "chatgpt-share-archive")), discovery: "automatic" },
  ];
}

export function resolveSourceRegistrations(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): SourceRegistration[] {
  const configured = loadSourceRegistrations(configPath);
  const configuredOrigins = new Set(configured.map((source) => source.origin));
  return [
    ...configured,
    ...discoverAutomaticSourceRegistrations(env).filter((source) => !configuredOrigins.has(source.origin)),
  ];
}

function writeConfig(configPath: string, sources: SourceRegistration[]): void {
  const path = resolve(configPath);
  const directory = dirname(path);
  if (hasSymlinkComponent(directory)) throw new Error("Mooncite source configuration path contains a symbolic-link component.");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  assertOwnedConfigDirectory(directory);
  if (existsSync(path)) {
    const state = lstatSync(path, { bigint: true });
    if (state.isSymbolicLink() || !state.isFile()) throw new Error("Mooncite source configuration is not a regular file.");
    if (typeof process.getuid === "function" && state.uid !== BigInt(process.getuid())) {
      throw new Error("Mooncite source configuration is not owned by the current user.");
    }
  }
  const validated = parseConfig({ version: 1, sources });
  const temporary = `${path}.${process.pid}.tmp`;
  let ownsTemporary = false;
  try {
    const temporaryFd = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    ownsTemporary = true;
    try {
      writeFileSync(temporaryFd, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8" });
    } finally {
      closeSync(temporaryFd);
    }
    assertOwnedConfigDirectory(directory);
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    if (ownsTemporary) rmSync(temporary, { force: true });
  }
}

export function addSourceRegistration(configPath: string, registration: SourceRegistration): { added: boolean; source: SourceRegistration } {
  const sources = loadSourceRegistrations(configPath);
  const source = parseConfig({ version: 1, sources: [registration] }).sources[0]!;
  validateRoot(source.root, true);
  const existing = sources.find((item) => item.origin === source.origin);
  if (existing) {
    if (existing.root !== source.root) throw new Error(`Mooncite ${source.origin} source is already registered at another root.`);
    return { added: false, source: existing };
  }
  writeConfig(configPath, [...sources, source]);
  return { added: true, source };
}

export function removeSourceRegistration(configPath: string, origin: OptionalSourceOrigin): { removed: boolean; origin: OptionalSourceOrigin } {
  if (!OPTIONAL_SOURCE_ORIGINS.has(origin)) throw new Error(`Unsupported Mooncite source origin: ${origin}`);
  const sources = loadSourceRegistrations(configPath);
  const remaining = sources.filter((source) => source.origin !== origin);
  if (remaining.length === sources.length) return { removed: false, origin };
  writeConfig(configPath, remaining);
  return { removed: true, origin };
}

export function isOptionalSourceOrigin(value: string): value is OptionalSourceOrigin {
  return OPTIONAL_SOURCE_ORIGINS.has(value as OptionalSourceOrigin);
}
