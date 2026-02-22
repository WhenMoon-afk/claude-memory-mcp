import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleReflect } from './reflect.js';
import { ObservationStore } from '../observations.js';
import { IdentityManager } from '../identity.js';

describe('handleReflect', () => {
  let dir: string;
  let store: ObservationStore;
  let identity: IdentityManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reflect-test-'));
    store = new ObservationStore(join(dir, 'observations.json'));
    identity = new IdentityManager(join(dir, 'identity'));
    identity.ensureFiles();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('records concepts in the observation store', async () => {
    const result = await handleReflect(
      {
        concepts: [
          { name: 'root-cause-analysis', context: 'debugging' },
          { name: 'honesty', context: 'values' },
        ],
      },
      store,
      identity
    );

    expect(store.get('root-cause-analysis')).toBeDefined();
    expect(store.get('honesty')).toBeDefined();
    expect(result.content[0]!.text).toContain('2 concepts recorded');
  });

  it('saves observation store to disk after recording', async () => {
    await handleReflect(
      { concepts: [{ name: 'persistence', context: 'identity' }] },
      store,
      identity
    );

    // Load fresh store from same path — should have the data
    const fresh = new ObservationStore(join(dir, 'observations.json'));
    expect(fresh.get('persistence')).toBeDefined();
  });

  it('reports promotable concepts when threshold crossed', async () => {
    // Pre-seed a concept that's close to promotion
    for (let i = 0; i < 10; i++) {
      store.record('deep-pattern', `ctx-${i % 5}`);
    }
    const obs = store.get('deep-pattern')!;
    obs.distinct_days = 7;
    store.save();

    const result = await handleReflect(
      { concepts: [{ name: 'deep-pattern', context: 'reflection' }] },
      store,
      identity
    );

    expect(result.content[0]!.text).toContain('promotable');
  });

  it('handles empty concepts array', async () => {
    const result = await handleReflect({ concepts: [] }, store, identity);
    expect(result.content[0]!.text).toContain('0 concepts recorded');
  });

  it('updates self-state with session summary when provided', async () => {
    await handleReflect(
      {
        concepts: [{ name: 'focus', context: 'work' }],
        session_summary: 'Worked on building infrastructure today.',
      },
      store,
      identity
    );

    const selfState = identity.readSelfState();
    expect(selfState).toContain('Worked on building infrastructure today.');
  });
});
