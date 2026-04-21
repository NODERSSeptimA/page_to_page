import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { MigrationEngine } from './migration.js';
import * as fixProposalsModule from '../analysis/fix-proposals.js';

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
      // Phase 2 artifacts must exist
      const slug = report.pagePath === '/' ? 'root' : report.pagePath.replace(/^\//, '').replace(/\//g, '__');
      const vpDir = join(work, 'artifacts', slug, 'desktop');
      expect(existsSync(join(vpDir, 'origin.dom.json'))).toBe(true);
      expect(existsSync(join(vpDir, 'target.dom.json'))).toBe(true);
      expect(existsSync(join(work, 'artifacts', slug, 'clusters.json'))).toBe(true);
      expect(existsSync(join(work, 'artifacts', slug, 'fix-proposals.json'))).toBe(true);
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

  it('resume does not advance cursor', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'p2p-peek-'));
    const stateFile = join(workDir, 'state.json');
    const artifactsDir = join(workDir, 'artifacts');
    const viewports = [{ name: 'desktop', width: 800, height: 600 }];

    const e = await MigrationEngine.init({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      stateFile, artifactsDir, viewports,
      concurrency: 2, maskSelectors: [], extraRoutes: [],
    });
    await e.close();

    const resumed = await MigrationEngine.resume({
      stateFile, artifactsDir, viewports,
      concurrency: 2, maskSelectors: [],
    });
    try {
      // Peek should not mutate
      const peek1 = resumed.peekNextPendingPath();
      const peek2 = resumed.peekNextPendingPath();
      expect(peek1).toBeDefined();
      expect(peek2).toEqual(peek1);
      expect(resumed.status().inProgress).toBe(0);

      // nextPage should return the same path
      const actual = resumed.nextPage();
      expect(actual?.path).toEqual(peek1);
      expect(resumed.status().inProgress).toBe(1);
    } finally { await resumed.close(); }
  }, 120_000);

  it('capture failure transitions page to error status', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'p2p-err-'));
    const stateFile = join(workDir, 'state.json');
    const artifactsDir = join(workDir, 'artifacts');
    // Use unreachable target URL to force a capture failure
    const e = await MigrationEngine.init({
      originUrl: fx.originUrl,
      targetUrl: fx.originUrl, // valid so discovery works
      stateFile, artifactsDir,
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [], extraRoutes: [],
    });
    try {
      const np = e.nextPage();
      expect(np).toBeDefined();
      // Monkey-patch capturer to throw (cleanest way to force error path)
      (e as unknown as { capturer: { capturePage: () => Promise<never> } }).capturer.capturePage =
        async () => { throw new Error('simulated capture failure'); };
      await expect(e.diffCurrent()).rejects.toThrow(/simulated capture failure/);
      // After failure, page should be 'error', current cleared
      expect(e.getPage(np!.path)?.status).toBe('error');
      expect(e.currentPath()).toBeUndefined();
      expect(e.status().error).toBe(1);
    } finally { await e.close(); }
  }, 60_000);

  it('analysis errors surface as report.analysisWarnings', async () => {
    const workDir = mkdtempSync(join(tmpdir(), 'p2p-warn-'));
    const e = await MigrationEngine.init({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      stateFile: join(workDir, 'state.json'),
      artifactsDir: join(workDir, 'artifacts'),
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [], extraRoutes: [],
    });
    try {
      e.nextPage();
      // First diff: everything succeeds, no warnings
      const report1 = await e.diffCurrent();
      expect(report1.analysisWarnings).toBeUndefined();
      // Force generateFixProposals to throw so the per-viewport catch fires
      const spy = vi.spyOn(fixProposalsModule, 'generateFixProposals').mockRejectedValue(new Error('simulated analysis failure'));
      try {
        const report2 = await e.diffCurrent();
        expect(report2.analysisWarnings).toBeDefined();
        expect(report2.analysisWarnings!.length).toBeGreaterThan(0);
        expect(report2.analysisWarnings![0]).toMatch(/analysis failed/);
      } finally {
        spy.mockRestore();
      }
    } finally { await e.close(); rmSync(workDir, { recursive: true, force: true }); }
  }, 120_000);
});
