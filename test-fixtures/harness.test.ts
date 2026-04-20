import { describe, it, expect } from 'vitest';
import { startFixtures } from './harness.js';

describe('fixtures harness', () => {
  it('starts both servers and serves pages + sitemap', async () => {
    const { originUrl, targetUrl, stop } = await startFixtures();
    try {
      const o = await (await fetch(`${originUrl}/`)).text();
      const t = await (await fetch(`${targetUrl}/`)).text();
      expect(o).toContain('Welcome');
      expect(t).toContain('Welcome');
      const sm = await (await fetch(`${originUrl}/sitemap.xml`)).text();
      expect(sm).toContain('<urlset');
    } finally { await stop(); }
  });
});
