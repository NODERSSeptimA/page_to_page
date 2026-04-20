import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './load.js';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-cfg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads minimal config with defaults', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({ originUrl: 'https://o.example.com', targetUrl: 'http://localhost:3000' }));
    const cfg = loadConfig(path);
    expect(cfg.originUrl).toBe('https://o.example.com');
    expect(cfg.viewports).toHaveLength(3);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.auth.enabled).toBe(false);
  });

  it('respects custom viewports', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({
      originUrl: 'https://o', targetUrl: 'https://t',
      viewports: [{ name: 'wide', width: 1920, height: 1080 }],
    }));
    const cfg = loadConfig(path);
    expect(cfg.viewports).toHaveLength(1);
  });

  it('rejects concurrency out of range', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({ originUrl: 'https://o', targetUrl: 'https://t', concurrency: 99 }));
    expect(() => loadConfig(path)).toThrow(/concurrency/);
  });

  it('helpful error on missing file', () => {
    expect(() => loadConfig(join(dir, 'missing.json'))).toThrow(/Config file not found/);
  });

  it('helpful error on invalid JSON', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, '{ not json');
    expect(() => loadConfig(path)).toThrow(/parse/i);
  });
});
