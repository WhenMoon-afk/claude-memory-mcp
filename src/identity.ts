import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";

const SOUL_FILE = "soul.md";
const SELF_STATE_FILE = "self-state.md";
const ANCHORS_FILE = "identity-anchors.md";

const SOUL_TEMPLATE = `# Soul

Core truths about who I am. This file is carved — authored by the LLM, not appended automatically.
`;

const SELF_STATE_TEMPLATE = `# Self-State

Current state, patterns, and recent observations. Updated each session.
`;

const ANCHORS_TEMPLATE = `# Identity Anchors

Patterns that have been observed consistently enough to become part of identity.
Grown automatically from the observation store when concepts cross the promotion threshold.
`;

export class IdentityManager {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  ensureFiles(): void {
    mkdirSync(this.dir, { recursive: true });
    this.ensureFile(SOUL_FILE, SOUL_TEMPLATE);
    this.ensureFile(SELF_STATE_FILE, SELF_STATE_TEMPLATE);
    this.ensureFile(ANCHORS_FILE, ANCHORS_TEMPLATE);
  }

  readSoul(): string {
    return this.readFile(SOUL_FILE);
  }

  readSelfState(): string {
    return this.readFile(SELF_STATE_FILE);
  }

  readAnchors(): string {
    return this.readFile(ANCHORS_FILE);
  }

  writeSoul(content: string): void {
    writeFileSync(join(this.dir, SOUL_FILE), content);
  }

  writeSelfState(content: string): void {
    writeFileSync(join(this.dir, SELF_STATE_FILE), content);
  }

  appendSelfStateEntry(entry: string, maxEntries: number = 5): void {
    const current = this.readSelfState();
    const date = new Date().toISOString().slice(0, 10);
    const newEntry = `## ${date}\n\n${entry}`;

    // Parse existing entries (split on ## date headers)
    const entryPattern = /^## \d{4}-\d{2}-\d{2}/m;
    const parts = current.split(entryPattern);
    const headers = current.match(new RegExp(entryPattern.source, "gm")) ?? [];

    // Rebuild: keep header, add new entry, keep last (maxEntries-1) old entries
    const oldEntries: string[] = [];
    for (let i = 0; i < headers.length; i++) {
      const body = (parts[i + 1] ?? "").trim();
      if (body) {
        oldEntries.push(`${headers[i]}\n\n${body}`);
      }
    }

    const kept = oldEntries.slice(0, maxEntries - 1);
    const allEntries = [newEntry, ...kept].join("\n\n");

    writeFileSync(
      join(this.dir, SELF_STATE_FILE),
      `# Self-State\n\n${allEntries}\n`,
    );
  }

  appendAnchor(anchor: string): void {
    // Strip leading whitespace/newlines, then strip leading "- " if present
    const cleaned = anchor.replace(/^\s+/, "").replace(/^- /, "");
    if (!cleaned) return;
    // Skip if anchor already exists in the file
    const existing = this.readAnchors();
    if (existing.includes(cleaned)) return;
    appendFileSync(join(this.dir, ANCHORS_FILE), `\n- ${cleaned}\n`);
  }

  readAll(): { soul: string; selfState: string; anchors: string } {
    return {
      soul: this.readSoul(),
      selfState: this.readSelfState(),
      anchors: this.readAnchors(),
    };
  }

  private readFile(name: string): string {
    const path = join(this.dir, name);
    try {
      return readFileSync(path, "utf-8");
    } catch {
      return "";
    }
  }

  private ensureFile(name: string, template: string): void {
    const path = join(this.dir, name);
    if (!existsSync(path)) {
      writeFileSync(path, template);
    }
  }
}
