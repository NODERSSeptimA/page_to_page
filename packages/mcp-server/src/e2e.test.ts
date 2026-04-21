import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtures, type FixtureHandles } from '../../../test-fixtures/harness.js';
import { createServer } from './server.js';

describe('E2E: full migration loop', () => {
  let fx: FixtureHandles; let work: string; let cfgPath: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'p2p-e2e-'));
    cfgPath = join(work, 'page-to-page.config.json');
    writeFileSync(cfgPath, JSON.stringify({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      concurrency: 2,
    }));
  });

  it('walks every page, diff detects known deltas, state persists', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      const seenDiffs: Array<{ path: string; diffPercent: number }> = [];
      for (let i = 0; i < 10; i++) {
        const np = await srv.call('next_page', {});
        if (np.done) break;
        const d = await srv.call('diff_current', {});
        for (const v of d.byViewport) seenDiffs.push({ path: d.pagePath, diffPercent: v.diffPercent });
        if (d.totalIssues === 0) await srv.call('mark_matched', {});
        else await srv.call('skip_current', { reason: 'known fixture delta' });
      }
      const home = seenDiffs.find((s) => s.path === '/');
      const about = seenDiffs.find((s) => s.path === '/about');
      const same = seenDiffs.find((s) => s.path === '/identical');
      expect(home!.diffPercent).toBeGreaterThan(0);
      expect(about!.diffPercent).toBeGreaterThan(0);
      expect(same!.diffPercent).toBeLessThan(0.001);
      const status = await srv.call('status', {});
      expect(status.pending).toBe(0);
      expect(existsSync(join(work, 'state.json'))).toBe(true);
      expect(existsSync(join(work, 'artifacts'))).toBe(true);

      // Verify fix proposals were generated for non-identical pages
      const proposalsFiles: string[] = [];
      for (const slug of ['root', 'about']) {
        const p = join(work, 'artifacts', slug, 'fix-proposals.json');
        if (existsSync(p)) proposalsFiles.push(p);
      }
      expect(proposalsFiles.length).toBeGreaterThanOrEqual(1);
      for (const f of proposalsFiles) {
        const arr = JSON.parse(readFileSync(f, 'utf-8'));
        expect(Array.isArray(arr)).toBe(true);
        for (const p of arr) {
          expect(['style_mismatch', 'missing_block', 'unknown']).toContain(p.kind);
        }
      }
    } finally { await srv.close(); }
  }, 240_000);
});
