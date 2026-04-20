import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { PageCapturer } from './capturer.js';

describe('PageCapturer', () => {
  let fx: FixtureHandles;
  let artifactsDir: string;
  beforeAll(async () => {
    fx = await startFixtures();
    artifactsDir = mkdtempSync(join(tmpdir(), 'p2p-art-'));
  }, 30_000);
  afterAll(async () => { await fx.stop(); rmSync(artifactsDir, { recursive: true, force: true }); });

  it('captures origin and target for one viewport', async () => {
    const c = await PageCapturer.launch({ concurrency: 2 });
    try {
      const r = await c.capturePage({
        originUrl: fx.originUrl,
        targetUrl: fx.targetUrl,
        pagePath: '/',
        viewports: [{ name: 'desktop', width: 800, height: 600 }],
        maskSelectors: [],
        artifactsDir,
      });
      expect(r.viewportResults).toHaveLength(1);
      const v = r.viewportResults[0]!;
      expect(existsSync(v.originPath)).toBe(true);
      expect(existsSync(v.targetPath)).toBe(true);
      expect(v.originError).toBeUndefined();
      expect(v.targetError).toBeUndefined();
    } finally { await c.close(); }
  }, 60_000);
});
