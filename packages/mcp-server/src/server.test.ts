import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtures, type FixtureHandles } from '../../../test-fixtures/harness.js';
import { createServer } from './server.js';

describe('MCP tools', () => {
  let fx: FixtureHandles; let work: string; let cfgPath: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'p2p-srv-'));
    cfgPath = join(work, 'page-to-page.config.json');
    writeFileSync(cfgPath, JSON.stringify({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      concurrency: 2,
    }));
  });

  it('init → next → diff → mark → status', async () => {
    const srv = createServer();
    try {
      const init = await srv.call('init_migration', { configPath: cfgPath });
      expect(init.discovered).toBeGreaterThan(0);
      const next = await srv.call('next_page', {});
      expect(next.path).toBeDefined();
      const diff = await srv.call('diff_current', {});
      expect(Array.isArray(diff.byViewport)).toBe(true);
      const marked = await srv.call('mark_matched', {});
      expect(marked.pagesRemaining).toBeGreaterThanOrEqual(0);
      const status = await srv.call('status', {});
      expect(status.total).toBeGreaterThan(0);
    } finally { await srv.close(); }
  }, 180_000);

  it('resume returns state from disk', async () => {
    const s1 = createServer();
    await s1.call('init_migration', { configPath: cfgPath });
    await s1.call('next_page', {});
    await s1.close();
    const s2 = createServer();
    try {
      const r = await s2.call('resume', { configPath: cfgPath });
      expect(r.total).toBeGreaterThan(0);
    } finally { await s2.close(); }
  }, 60_000);

  it('verify_current before next_page errors', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      await expect(srv.call('verify_current', {})).rejects.toThrow(/no page in progress/i);
    } finally { await srv.close(); }
  }, 30_000);

  it('mark_has_issues transitions page to has_issues', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      const np = await srv.call('next_page', {});
      expect(np.path).toBeDefined();
      await srv.call('diff_current', {});
      const result = await srv.call('mark_has_issues', { note: 'font mismatch needs design team' });
      expect(result.pagesRemaining).toBeGreaterThanOrEqual(0);
      const st = await srv.call('status', {});
      expect(st.hasIssues).toBe(1);
    } finally { await srv.close(); }
  }, 180_000);

  it('get_fix_proposals returns FixProposal[] after diff', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      await srv.call('next_page', {});
      await srv.call('diff_current', {});
      const proposals = await srv.call('get_fix_proposals', {});
      expect(Array.isArray(proposals)).toBe(true);
      for (const p of proposals) {
        expect(['style_mismatch', 'missing_block', 'unknown']).toContain(p.kind);
        expect(p.clusterId).toBeDefined();
        expect(p.bbox).toBeDefined();
      }
    } finally { await srv.close(); }
  }, 180_000);

  it('get_fix_proposals without diff_current errors', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      await srv.call('next_page', {});
      await expect(srv.call('get_fix_proposals', {}))
        .rejects.toThrow(/no fix proposals|diff_current/i);
    } finally { await srv.close(); }
  }, 30_000);

  it('get_fix_proposals accepts pagePath after mark_matched', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      const next = await srv.call('next_page', {});
      expect(next.path).toBeDefined();
      const pagePath = next.path;
      await srv.call('diff_current', {});
      await srv.call('mark_matched', {});
      // After mark_matched, current is cleared. Explicit pagePath should still work.
      const proposals = await srv.call('get_fix_proposals', { pagePath });
      expect(Array.isArray(proposals)).toBe(true);
    } finally { await srv.close(); }
  }, 180_000);
});
