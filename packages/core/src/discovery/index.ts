import type { Page } from '../types.js';
import { fetchSitemapPaths } from './sitemap.js';
import { crawlPaths } from './crawler.js';

export { fetchSitemapPaths, crawlPaths };

export interface DiscoveryInput { originUrl: string; extraRoutes?: string[] }

export async function discoverPages(input: DiscoveryInput): Promise<Page[]> {
  const sitemap = await fetchSitemapPaths(input.originUrl);
  const crawl = sitemap.length === 0 ? await crawlPaths(input.originUrl) : [];
  const manual = input.extraRoutes ?? [];
  const seen = new Set<string>();
  const pages: Page[] = [];
  const add = (path: string, source: Page['source']): void => {
    if (seen.has(path)) return;
    seen.add(path);
    pages.push({ path, status: 'pending', source, fixHistory: [] });
  };
  for (const p of sitemap) add(p, 'sitemap');
  for (const p of crawl) add(p, 'crawl');
  for (const p of manual) add(p, 'manual');
  if (pages.length === 0) {
    throw new Error(
      'No pages discovered. Sitemap empty/missing, crawler found nothing, no extraRoutes. ' +
      'Add `extraRoutes` to page-to-page.config.json.',
    );
  }
  return pages;
}
