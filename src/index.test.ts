import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from './index.js';

describe('createServer', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'server-test-'));
    process.env['XDG_DATA_HOME'] = dir;
  });

  afterEach(() => {
    delete process.env['XDG_DATA_HOME'];
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an MCP server instance', () => {
    const server = createServer();
    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
  });

  it('creates identity files on startup', () => {
    createServer();
    const { readFileSync } = require('node:fs');
    const identityDir = join(dir, 'claude-memory', 'identity');
    expect(readFileSync(join(identityDir, 'soul.md'), 'utf-8')).toContain('# Soul');
  });
});
