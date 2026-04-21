import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { fetchSitemapPaths, crawlPaths, discoverPages } from './index.js';

describe('discovery', () => {
  let fx: FixtureHandles;
  beforeAll(async () => { fx = await startFixtures(); });
  afterAll(async () => { await fx.stop(); });

  it('fetchSitemapPaths returns sitemap paths', async () => {
    const paths = (await fetchSitemapPaths(fx.originUrl)).sort();
    expect(paths).toEqual(['/', '/about', '/delayed', '/identical']);
  });

  it('crawlPaths walks links with depth limit', async () => {
    const paths = await crawlPaths(fx.originUrl, { maxDepth: 2 });
    expect(paths).toContain('/');
  });

  it('discoverPages merges sitemap + manual', async () => {
    const pages = await discoverPages({ originUrl: fx.originUrl, extraRoutes: ['/hidden'] });
    const paths = pages.map((p) => p.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/hidden');
    expect(pages.find((p) => p.path === '/hidden')?.source).toBe('manual');
    expect(pages.find((p) => p.path === '/')?.source).toBe('sitemap');
  });
});
