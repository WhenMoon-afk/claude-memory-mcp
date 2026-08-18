import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function jsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export interface Fixture {
  home: string;
  sessionsRoot: string;
  stateDir: string;
  source: string;
  sourceDigest: string;
  cleanup(): Promise<void>;
}

export async function createFixture(): Promise<Fixture> {
  const home = await mkdtemp(join(tmpdir(), "mooncite-contract-"));
  const sessionsRoot = join(home, ".pi", "agent", "sessions");
  const project = join(sessionsRoot, "--moon-project--");
  const stateDir = join(home, ".local", "state", "mooncite");
  await mkdir(project, { recursive: true });
  const source = join(project, "session.jsonl");
  const content =
    jsonLine({ type: "session", version: 3, id: "session-moon", timestamp: "2030-01-01T00:00:00.000Z", cwd: "/work/moon-project" }) +
    jsonLine({ type: "message", id: "entry-a", parentId: null, timestamp: "2030-01-01T00:00:01.000Z", message: { role: "user", content: "The launch marker is silver-cedar-17." } }) +
    jsonLine({ type: "message", id: "entry-b", parentId: "entry-a", timestamp: "2030-01-01T00:00:02.000Z", message: { role: "assistant", content: [{ type: "text", text: "Confirmed the source stays unchanged." }] } });
  await writeFile(source, content, { mode: 0o600 });
  const sourceDigest = createHash("sha256").update(await readFile(source)).digest("hex");
  return {
    home,
    sessionsRoot,
    stateDir,
    source,
    sourceDigest,
    cleanup: async () => rm(home, { recursive: true, force: true }),
  };
}

export async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}
