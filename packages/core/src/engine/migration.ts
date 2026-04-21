import { StateStore } from '../state/store.js';
import { discoverPages } from '../discovery/index.js';
import { PageCapturer, type CaptureResult } from '../capture/capturer.js';
import { pixelDiff } from '../diff/pixel.js';
import type { Page, ViewportSpec, PixelDiffReport, PixelDiffViewportEntry, DomSnapshot, Cluster, FixProposal } from '../types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { extractClusters } from '../diff/clusters.js';
import { generateFixProposals } from '../analysis/fix-proposals.js';

const ISSUE_THRESHOLD = 0.001;

export interface MigrationInit {
  originUrl: string; targetUrl: string;
  stateFile: string; artifactsDir: string;
  viewports: ReadonlyArray<ViewportSpec>;
  concurrency: number;
  maskSelectors: ReadonlyArray<string>;
  extraRoutes: ReadonlyArray<string>;
  /** Override default 5s networkidle wait after load. Use 0 to skip. */
  idleTimeoutMs?: number;
  /** CSS selector to wait for before screenshot (SPA data-driven content). */
  waitForSelector?: string;
}

export interface MigrationResumeOpts {
  stateFile: string; artifactsDir: string;
  viewports: ReadonlyArray<ViewportSpec>;
  concurrency: number;
  maskSelectors: ReadonlyArray<string>;
  idleTimeoutMs?: number;
  waitForSelector?: string;
}

export interface EngineStatus {
  total: number;
  pending: number; inProgress: number;
  matched: number; hasIssues: number;
  skipped: number; error: number;
  current?: string;
}

export class MigrationEngine {
  private constructor(
    private readonly store: StateStore,
    private readonly capturer: PageCapturer,
    private readonly opts: {
      originUrl: string; targetUrl: string;
      artifactsDir: string;
      viewports: ReadonlyArray<ViewportSpec>;
      maskSelectors: ReadonlyArray<string>;
      idleTimeoutMs?: number;
      waitForSelector?: string;
    },
  ) {}

  static async init(input: MigrationInit): Promise<MigrationEngine> {
    const pages = await discoverPages({ originUrl: input.originUrl, extraRoutes: [...input.extraRoutes] });
    const store = StateStore.create(input.stateFile, { originUrl: input.originUrl, targetUrl: input.targetUrl });
    store.addPages(pages);
    const capturer = await PageCapturer.launch({ concurrency: input.concurrency });
    mkdirSync(input.artifactsDir, { recursive: true });
    return new MigrationEngine(store, capturer, {
      originUrl: input.originUrl, targetUrl: input.targetUrl,
      artifactsDir: input.artifactsDir,
      viewports: input.viewports, maskSelectors: input.maskSelectors,
      idleTimeoutMs: input.idleTimeoutMs, waitForSelector: input.waitForSelector,
    });
  }

  static async resume(opts: MigrationResumeOpts): Promise<MigrationEngine> {
    const store = StateStore.load(opts.stateFile);
    const data = store.data();
    const capturer = await PageCapturer.launch({ concurrency: opts.concurrency });
    mkdirSync(opts.artifactsDir, { recursive: true });
    return new MigrationEngine(store, capturer, {
      originUrl: data.originUrl, targetUrl: data.targetUrl,
      artifactsDir: opts.artifactsDir,
      viewports: opts.viewports, maskSelectors: opts.maskSelectors,
      idleTimeoutMs: opts.idleTimeoutMs, waitForSelector: opts.waitForSelector,
    });
  }

  async close(): Promise<void> { await this.capturer.close(); }

  status(): EngineStatus {
    const pages = this.store.data().pages;
    const c = { pending: 0, in_progress: 0, matched: 0, has_issues: 0, skipped: 0, error: 0 };
    for (const p of pages) c[p.status]++;
    return {
      total: pages.length,
      pending: c.pending, inProgress: c.in_progress,
      matched: c.matched, hasIssues: c.has_issues,
      skipped: c.skipped, error: c.error,
      current: this.store.data().current,
    };
  }

  peekNextPendingPath(): string | undefined {
    return this.store.data().pages.find((p) => p.status === 'pending')?.path;
  }

  nextPage(): Page | undefined {
    const pages = this.store.data().pages;
    const next = pages.find((p) => p.status === 'pending');
    if (!next) return undefined;
    this.store.updatePage(next.path, { status: 'in_progress' });
    this.store.setCurrent(next.path);
    return this.store.getPage(next.path);
  }

  getPage(path: string): Page | undefined { return this.store.getPage(path); }
  currentPath(): string | undefined { return this.store.data().current; }

  proposalsPath(pagePath?: string): string {
    const resolved = pagePath ?? this.currentPath();
    if (!resolved) throw new Error('No page specified. Pass pagePath or call nextPage() first.');
    return join(this.opts.artifactsDir, slug(resolved), 'fix-proposals.json');
  }

  async diffCurrent(): Promise<PixelDiffReport> {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress. Call nextPage() first.');
    return this.diffPath(current);
  }

  async verifyCurrent(): Promise<PixelDiffReport> { return this.diffCurrent(); }

  private async diffPath(pagePath: string): Promise<PixelDiffReport> {
    try {
      const cap: CaptureResult = await this.capturer.capturePage({
        originUrl: this.opts.originUrl, targetUrl: this.opts.targetUrl,
        pagePath, viewports: this.opts.viewports,
        maskSelectors: this.opts.maskSelectors, artifactsDir: this.opts.artifactsDir,
        idleTimeoutMs: this.opts.idleTimeoutMs, waitForSelector: this.opts.waitForSelector,
      });
      const entries: PixelDiffViewportEntry[] = [];
      let issuesCount = 0;
      for (const vr of cap.viewportResults) {
        if (vr.originError || vr.targetError) {
          issuesCount++;
          entries.push({ viewport: vr.viewport, diffPercent: 1, originPath: vr.originPath, targetPath: vr.targetPath, diffPath: '' });
          continue;
        }
        const diffPath = vr.originPath.replace(/origin\.png$/, 'diff.png');
        const res = await pixelDiff(vr.originPath, vr.targetPath, diffPath);
        if (res.diffPercent > ISSUE_THRESHOLD) issuesCount++;
        entries.push({
          viewport: vr.viewport, diffPercent: res.diffPercent,
          originPath: vr.originPath, targetPath: vr.targetPath, diffPath,
        });
      }
      const artifactsDir = join(this.opts.artifactsDir, slug(pagePath));
      // Phase 2: cluster extraction + fix proposals, per viewport, aggregated across viewports
      const allClusters: Cluster[] = [];
      const allProposals: FixProposal[] = [];
      const analysisWarnings: string[] = [];
      for (const vr of cap.viewportResults) {
        if (vr.originError || vr.targetError) continue;
        const diffPath = vr.originPath.replace(/origin\.png$/, 'diff.png');
        const originDomPath = vr.originPath.replace(/origin\.png$/, 'origin.dom.json');
        const targetDomPath = vr.targetPath.replace(/target\.png$/, 'target.dom.json');
        const vpArtifactsDir = join(artifactsDir, vr.viewport);
        try {
          const diffBuf = readFileSync(diffPath);
          const clusters = extractClusters(diffBuf);
          allClusters.push(...clusters);
          const originSnap = JSON.parse(readFileSync(originDomPath, 'utf-8')) as DomSnapshot;
          const targetSnap = JSON.parse(readFileSync(targetDomPath, 'utf-8')) as DomSnapshot;
          const proposals = await generateFixProposals({
            viewport: vr.viewport,
            originSnapshot: originSnap,
            targetSnapshot: targetSnap,
            clusters,
            originPng: readFileSync(vr.originPath),
            targetPng: readFileSync(vr.targetPath),
            diffPng: diffBuf,
            artifactsDir: vpArtifactsDir,
          });
          allProposals.push(...proposals);
        } catch (analysisErr) {
          analysisWarnings.push(`[${vr.viewport}] analysis failed: ${(analysisErr as Error).message}`);
        }
      }
      writeFileSync(join(artifactsDir, 'clusters.json'), JSON.stringify(allClusters, null, 2));
      writeFileSync(join(artifactsDir, 'fix-proposals.json'), JSON.stringify(allProposals, null, 2));
      const report: PixelDiffReport = {
        pagePath, viewports: entries, totalIssues: issuesCount, artifactsDir,
        ...(analysisWarnings.length > 0 ? { analysisWarnings } : {}),
      };
      writeFileSync(join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
      this.store.updatePage(pagePath, { lastRunAt: new Date().toISOString(), issuesCount });
      return report;
    } catch (err) {
      this.store.updatePage(pagePath, {
        status: 'error',
        lastRunAt: new Date().toISOString(),
      });
      this.store.setCurrent(undefined);
      throw err;
    }
  }

  markMatched(): void {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress.');
    this.store.updatePage(current, { status: 'matched' });
    this.store.setCurrent(undefined);
  }

  markHasIssues(note?: string): void {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress.');
    this.store.updatePage(current, { status: 'has_issues', skipReason: note });
    this.store.setCurrent(undefined);
  }

  skipCurrent(reason: string): void {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress.');
    this.store.updatePage(current, { status: 'skipped', skipReason: reason });
    this.store.setCurrent(undefined);
  }
}

function slug(p: string): string { return p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '__'); }
