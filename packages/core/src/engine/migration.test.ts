import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { MigrationEngine } from './migration.js';

describe('MigrationEngine', () => {
  let fx: FixtureHandles; let work: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'p2p-eng-')); });

  it('init → next → diff → mark, then resume', async () => {
    const e = await MigrationEngine.init({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [], extraRoutes: [],
    });
    try {
      expect(e.status().total).toBeGreaterThan(0);
      const np = e.nextPage(); expect(np).toBeDefined();
      const report = await e.diffCurrent();
      expect(report.viewports).toHaveLength(1);
      e.markMatched();
      expect(e.getPage(np!.path)?.status).toBe('matched');
    } finally { await e.close(); }

    const r = await MigrationEngine.resume({
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [],
    });
    try {
      const matched = r.status().matched;
      expect(matched).toBeGreaterThan(0);
    } finally { await r.close(); }
  }, 120_000);
});
