import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}
export function ompTitleLine(title: string): string {
  const unpadded = JSON.stringify({ type: "title", v: 1, title, source: "auto", pad: "" });
  const targetBytes = 256;
  const padding = targetBytes - Buffer.byteLength(unpadded);
  if (padding < 0) throw new Error("OMP fixture title exceeds its fixed-width record.");
  return jsonLine({ type: "title", v: 1, title, source: "auto", pad: " ".repeat(padding) });
}


export interface Fixture {
  home: string;
  sessionsRoot: string;
  ompSessionsRoot: string;
  stateDir: string;
  source: string;
  ompSource: string;
  sourceDigest: string;
  ompSourceDigest: string;
  cleanup(): Promise<void>;
}

export async function createFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "mooncite-contract-"));
  const sessionsRoot = join(home, ".pi", "agent", "sessions");
  const project = join(sessionsRoot, "--moon-project--");
  const stateDir = join(home, ".local", "state", "mooncite");
  const ompSessionsRoot = join(home, ".omp", "agent", "sessions");
  const ompProject = join(ompSessionsRoot, "-moon-project");
  await mkdir(project, { recursive: true });
  await mkdir(ompProject, { recursive: true });
  const source = join(project, "session.jsonl");
  const content =
    jsonLine({ type: "session", version: 3, id: "session-moon", timestamp: "2030-01-01T00:00:00.000Z", cwd: "/work/moon-project" }) +
    jsonLine({ type: "message", id: "entry-a", parentId: null, timestamp: "2030-01-01T00:00:01.000Z", message: { role: "user", content: "The launch marker is silver-cedar-17." } }) +
    jsonLine({ type: "message", id: "entry-b", parentId: "entry-a", timestamp: "2030-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Confirmed the source stays unchanged." }] } });
  await writeFile(source, content, { mode: 0o600 });
  const ompSource = join(ompProject, "session.jsonl");
  const ompContent =
    ompTitleLine("Moon project") +
    jsonLine({ type: "session", version: 3, id: "session-moon", timestamp: "2030-01-02T00:00:00.000Z", cwd: "/work/moon-project" }) +
    jsonLine({ type: "message", id: "entry-a", parentId: null, timestamp: "2030-01-02T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: "The OMP launch marker is violet-orbit-41." }] } }) +
    jsonLine({ type: "message", id: "entry-b", parentId: "entry-a", timestamp: "2030-01-02T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "OMP source remains read-only." }] } });
  await writeFile(ompSource, ompContent, { mode: 0o600 });
  const ompSourceDigest = createHash("sha256").update(await readFile(ompSource)).digest("hex");
  const sourceDigest = createHash("sha256").update(await readFile(source)).digest("hex");
  return {
    home,
    sessionsRoot,
    ompSessionsRoot,
    stateDir,
    source,
    ompSource,
    sourceDigest,
    ompSourceDigest,
    cleanup: async () => rm(home, { recursive: true, force: true }),
  };
}

export async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
