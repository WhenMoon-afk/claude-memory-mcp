import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDataDir, getObservationsPath, getIdentityDir } from './paths.js';

describe('getDataDir', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses XDG_DATA_HOME when set', () => {
    process.env['XDG_DATA_HOME'] = '/custom/data';
    expect(getDataDir()).toBe('/custom/data/claude-memory');
  });

  it('falls back to ~/.local/share when XDG_DATA_HOME is unset', () => {
    delete process.env['XDG_DATA_HOME'];
    process.env['HOME'] = '/home/testuser';
    expect(getDataDir()).toBe('/home/testuser/.local/share/claude-memory');
  });
});

describe('getObservationsPath', () => {
  beforeEach(() => {
    process.env['XDG_DATA_HOME'] = '/custom/data';
  });

  afterEach(() => {
    delete process.env['XDG_DATA_HOME'];
  });

  it('returns observations.json inside data dir', () => {
    expect(getObservationsPath()).toBe('/custom/data/claude-memory/observations.json');
  });
});

describe('getIdentityDir', () => {
  beforeEach(() => {
    process.env['XDG_DATA_HOME'] = '/custom/data';
  });

  afterEach(() => {
    delete process.env['XDG_DATA_HOME'];
  });

  it('returns identity subdirectory inside data dir', () => {
    expect(getIdentityDir()).toBe('/custom/data/claude-memory/identity');
  });
});
