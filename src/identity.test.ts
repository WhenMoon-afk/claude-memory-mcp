import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { IdentityManager } from './identity.js';

describe('IdentityManager', () => {
  let dir: string;
  let mgr: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'identity-test-'));
    mgr = new IdentityManager(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe('ensureFiles', () => {
    it('creates all three identity files if missing', () => {
      mgr.ensureFiles();
      expect(readFileSync(join(dir, 'soul.md'), 'utf-8')).toContain('# Soul');
      expect(readFileSync(join(dir, 'self-state.md'), 'utf-8')).toContain('# Self-State');
      expect(readFileSync(join(dir, 'identity-anchors.md'), 'utf-8')).toContain(
        '# Identity Anchors'
      );
    });

    it('does not overwrite existing files', () => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'soul.md'), '# My Custom Soul\n\nI am unique.');
      mgr.ensureFiles();
      expect(readFileSync(join(dir, 'soul.md'), 'utf-8')).toBe('# My Custom Soul\n\nI am unique.');
    });
  });

  describe('readSoul', () => {
    it('returns soul.md content', () => {
      mgr.ensureFiles();
      const content = mgr.readSoul();
      expect(content).toContain('# Soul');
    });

    it('returns empty string if file missing', () => {
      expect(mgr.readSoul()).toBe('');
    });
  });

  describe('readSelfState', () => {
    it('returns self-state.md content', () => {
      mgr.ensureFiles();
      expect(mgr.readSelfState()).toContain('# Self-State');
    });
  });

  describe('readAnchors', () => {
    it('returns identity-anchors.md content', () => {
      mgr.ensureFiles();
      expect(mgr.readAnchors()).toContain('# Identity Anchors');
    });
  });

  describe('writeSoul', () => {
    it('writes to soul.md', () => {
      mgr.ensureFiles();
      mgr.writeSoul('# Soul\n\nI value honesty.');
      expect(readFileSync(join(dir, 'soul.md'), 'utf-8')).toBe('# Soul\n\nI value honesty.');
    });
  });

  describe('writeSelfState', () => {
    it('writes to self-state.md', () => {
      mgr.ensureFiles();
      mgr.writeSelfState('# Self-State\n\nFeeling focused.');
      expect(readFileSync(join(dir, 'self-state.md'), 'utf-8')).toBe(
        '# Self-State\n\nFeeling focused.'
      );
    });
  });

  describe('appendAnchor', () => {
    it('appends a new anchor to identity-anchors.md', () => {
      mgr.ensureFiles();
      mgr.appendAnchor('I tend toward root-cause analysis over workarounds');
      const content = readFileSync(join(dir, 'identity-anchors.md'), 'utf-8');
      expect(content).toContain('I tend toward root-cause analysis over workarounds');
    });

    it('preserves existing anchors when appending', () => {
      mgr.ensureFiles();
      mgr.appendAnchor('First anchor');
      mgr.appendAnchor('Second anchor');
      const content = readFileSync(join(dir, 'identity-anchors.md'), 'utf-8');
      expect(content).toContain('First anchor');
      expect(content).toContain('Second anchor');
    });
  });

  describe('readAll', () => {
    it('returns all three files as a combined object', () => {
      mgr.ensureFiles();
      const all = mgr.readAll();
      expect(all.soul).toContain('# Soul');
      expect(all.selfState).toContain('# Self-State');
      expect(all.anchors).toContain('# Identity Anchors');
    });
  });
});
