import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOUL_FILE = 'soul.md';
const SELF_STATE_FILE = 'self-state.md';
const ANCHORS_FILE = 'identity-anchors.md';

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

  appendAnchor(anchor: string): void {
    appendFileSync(join(this.dir, ANCHORS_FILE), `\n- ${anchor}\n`);
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
      return readFileSync(path, 'utf-8');
    } catch {
      return '';
    }
  }

  private ensureFile(name: string, template: string): void {
    const path = join(this.dir, name);
    if (!existsSync(path)) {
      writeFileSync(path, template);
    }
  }
}
