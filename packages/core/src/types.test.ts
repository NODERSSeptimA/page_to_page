import { describe, it, expect } from 'vitest';
import type { Page, PageStatus, ViewportSpec, PixelDiffReport } from './types.js';
import { DEFAULT_VIEWPORTS } from './types.js';

describe('shared types', () => {
  it('PageStatus covers all 6 states', () => {
    const s: PageStatus[] = ['pending','in_progress','matched','has_issues','skipped','error'];
    expect(s).toHaveLength(6);
  });
  it('Page requires path/status/source/fixHistory', () => {
    const p: Page = { path: '/x', status: 'pending', source: 'sitemap', fixHistory: [] };
    expect(p.path).toBe('/x');
  });
  it('DEFAULT_VIEWPORTS has mobile/tablet/desktop', () => {
    expect(DEFAULT_VIEWPORTS.map((v: ViewportSpec) => v.name)).toEqual(['mobile','tablet','desktop']);
  });
  it('PixelDiffReport shape', () => {
    const r: PixelDiffReport = {
      pagePath: '/x', totalIssues: 0, artifactsDir: 'd',
      viewports: [{ viewport: 'desktop', diffPercent: 0, originPath: 'o', targetPath: 't', diffPath: 'd' }],
    };
    expect(r.viewports[0]!.diffPercent).toBe(0);
  });
});
