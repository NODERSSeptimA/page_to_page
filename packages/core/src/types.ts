export type PageStatus = 'pending' | 'in_progress' | 'matched' | 'has_issues' | 'skipped' | 'error';
export type PageSource = 'sitemap' | 'crawl' | 'manual';

export interface FixHistoryEntry { at: string; description: string }

export interface Page {
  path: string;
  status: PageStatus;
  source: PageSource;
  authRequired?: boolean;
  lastRunAt?: string;
  issuesCount?: number;
  skipReason?: string;
  fixHistory: FixHistoryEntry[];
}

export interface ViewportSpec { name: string; width: number; height: number }

export const DEFAULT_VIEWPORTS: ReadonlyArray<ViewportSpec> = Object.freeze([
  { name: 'mobile',  width: 375,  height: 812 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]);

export interface PixelDiffViewportEntry {
  viewport: string;
  diffPercent: number;
  originPath: string;
  targetPath: string;
  diffPath: string;
}

export interface PixelDiffReport {
  pagePath: string;
  viewports: PixelDiffViewportEntry[];
  totalIssues: number;
  artifactsDir: string;
}
