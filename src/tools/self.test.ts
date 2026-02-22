import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleSelf } from './self.js';
import { ObservationStore } from '../observations.js';
import { IdentityManager } from '../identity.js';

describe('handleSelf', () => {
  let dir: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'self-test-'));
    store = new ObservationStore(join(dir, 'observations.json'));
    identity = new IdentityManager(join(dir, 'identity'));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns all three identity files', async () => {
    identity.writeSoul('# Soul\n\nI am Cadence.');
    identity.writeSelfState('# Self-State\n\nFeeling good.');

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    expect(text).toContain('I am Cadence');
    expect(text).toContain('Feeling good');
    expect(text).toContain('Identity Anchors');
  });

  it('includes observation stats when observations exist', async () => {
    store.record('debugging', 'problem-solving');
    store.record('honesty', 'values');
    store.save();

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    expect(text).toContain('debugging');
    expect(text).toContain('honesty');
  });

  it('works with empty identity files', async () => {
    const result = await handleSelf({}, store, identity);
    expect(result.content[0]!.text).toBeDefined();
  });

  it('includes top observations sorted by score', async () => {
    // Create observations with different strengths
    for (let i = 0; i < 5; i++) {
      store.record('strong-pattern', `ctx-${i}`);
    }
    store.get('strong-pattern')!.distinct_days = 5;

    store.record('weak-pattern', 'ctx-a');
    store.save();

    const result = await handleSelf({}, store, identity);
    const text = result.content[0]!.text;

    // Strong pattern should appear before weak
    const strongIdx = text.indexOf('strong-pattern');
    const weakIdx = text.indexOf('weak-pattern');
    expect(strongIdx).toBeLessThan(weakIdx);
  });
});
