import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from './store.js';

describe('StateStore', () => {
  let dir: string; let path: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-st-')); path = join(dir, 's.json'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates fresh state', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    expect(s.data().pages).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
  });

  it('persists and reloads pages', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([
      { path: '/a', status: 'pending', source: 'sitemap', fixHistory: [] },
      { path: '/b', status: 'pending', source: 'crawl',   fixHistory: [] },
    ]);
    const loaded = StateStore.load(path);
    expect(loaded.data().pages.map((p) => p.path)).toEqual(['/a','/b']);
  });

  it('updatePage is atomic', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    s.updatePage('/x', { status: 'in_progress' });
    expect(s.getPage('/x')!.status).toBe('in_progress');
  });

  it('recovers via .bak when primary corrupts', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    writeFileSync(path, '{ not json');
    const loaded = StateStore.load(path);
    expect(loaded.data().pages).toHaveLength(1);
  });

  it('throws clearly when both primary and .bak corrupt', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    writeFileSync(path, 'broken');
    writeFileSync(`${path}.bak`, 'broken');
    expect(() => StateStore.load(path)).toThrow(/unrecoverable|both/i);
  });
});
