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

// ── Phase 2 types ─────────────────────────────────────────────────────────────

export interface Bbox { x: number; y: number; width: number; height: number }

export interface Cluster {
  id: string;
  bbox: Bbox;
  pixelCount: number;
}

export interface DomElement {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  bbox: Bbox;
  computedStyles: Record<string, string>;
  parentIndex: number;
}

export interface DomSnapshot {
  pagePath: string;
  viewport: string;
  elements: DomElement[];
  capturedAt: string;
  truncated?: true;
  error?: string;
}

export interface StyleDiff {
  property: string;
  origin: string;
  target: string;
}

interface FixProposalBase {
  clusterId: string;
  viewport: string;
  bbox: Bbox;
  originCropPath: string;
  targetCropPath: string;
}

export interface StyleMismatchProposal extends FixProposalBase {
  kind: 'style_mismatch';
  styleDiffs: StyleDiff[];
  suggestedSearchTerms: string[];
  originTextSample?: string;
  warning?: string;
}

export interface MissingBlockProposal extends FixProposalBase {
  kind: 'missing_block';
  side: 'origin_only' | 'target_only';
  missingElementSummary: string;
  suggestedSearchTerms: string[];
  warning?: string;
}

export interface UnknownProposal extends FixProposalBase {
  kind: 'unknown';
  warning: string;
  suggestedSearchTerms: string[];
}

export type FixProposal = StyleMismatchProposal | MissingBlockProposal | UnknownProposal;
