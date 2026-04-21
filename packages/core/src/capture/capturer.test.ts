import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
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

  it('waitForSelector blocks screenshot until data-driven content appears', async () => {
    const c = await PageCapturer.launch({ concurrency: 2 });
    try {
      // Without waitForSelector and with idle wait disabled, capture races the 300ms
      // setTimeout in /delayed fixture — screenshot happens before #ready exists.
      const fastCapture = await c.capturePage({
        originUrl: fx.originUrl, targetUrl: fx.targetUrl,
        pagePath: '/delayed',
        viewports: [{ name: 'desktop', width: 800, height: 600 }],
        maskSelectors: [], artifactsDir,
        idleTimeoutMs: 0,
      });
      const fastDomPath = fastCapture.viewportResults[0]!.originPath
        .replace(/origin\.png$/, 'origin.dom.json');
      const fastDom = JSON.parse(readFileSync(fastDomPath, 'utf-8'));
      // The #ready element shouldn't exist yet — setTimeout hasn't fired.
      const fastHasReady = fastDom.elements.some(
        (el: { attrs: Record<string, string> }) => el.attrs.id === 'ready',
      );
      expect(fastHasReady).toBe(false);

      // With waitForSelector, capture blocks until #ready appears.
      const slowCapture = await c.capturePage({
        originUrl: fx.originUrl, targetUrl: fx.targetUrl,
        pagePath: '/delayed',
        viewports: [{ name: 'desktop', width: 800, height: 600 }],
        maskSelectors: [], artifactsDir,
        idleTimeoutMs: 0,
        waitForSelector: '#ready',
      });
      const slowDomPath = slowCapture.viewportResults[0]!.originPath
        .replace(/origin\.png$/, 'origin.dom.json');
      const slowDom = JSON.parse(readFileSync(slowDomPath, 'utf-8'));
      const slowHasReady = slowDom.elements.some(
        (el: { attrs: Record<string, string> }) => el.attrs.id === 'ready',
      );
      expect(slowHasReady).toBe(true);
    } finally { await c.close(); }
  }, 60_000);

  it('mask survives framework-style re-render (CSS via addStyleTag, not inline style)', async () => {
    const c = await PageCapturer.launch({ concurrency: 2 });
    try {
      // /rerender fixture swaps its [data-rerender-root] subtree 400ms after load
      // via replaceChildren() — simulates Angular change detection. idleTimeoutMs
      // of 1500 gives the re-render a chance to complete before screenshot.
      // waitForSelector forces us to wait for the post-swap h1, proving the
      // screenshot really lands AFTER the re-render.
      const r = await c.capturePage({
        originUrl: fx.originUrl, targetUrl: fx.targetUrl,
        pagePath: '/rerender',
        viewports: [{ name: 'desktop', width: 800, height: 600 }],
        maskSelectors: ['#rerender-root'],
        artifactsDir,
        idleTimeoutMs: 1500,
      });
      const v = r.viewportResults[0]!;
      expect(v.originError).toBeUndefined();
      const originDomPath = v.originPath.replace(/origin\.png$/, 'origin.dom.json');
      const dom = JSON.parse(readFileSync(originDomPath, 'utf-8'));
      // The re-render has occurred (Swapped h1 is present).
      const swappedH1 = dom.elements.find(
        (el: { tag: string; text: string }) => el.tag === 'h1' && el.text.includes('Swapped'),
      );
      expect(swappedH1).toBeDefined();
      // After re-render, the host element's computed background still reflects
      // the mask (grey), because CSS-injection keeps re-applying on every
      // restyle. An inline-style mask would have been wiped when replaceChildren
      // fired.
      const host = dom.elements.find(
        (el: { attrs: Record<string, string> }) => el.attrs.id === 'rerender-root',
      );
      expect(host).toBeDefined();
      const bg = (host.computedStyles as Record<string, string>)['background-color']
        ?? (host.computedStyles as Record<string, string>)['background'];
      // #cccccc expressed as rgb
      expect(bg).toContain('204');
    } finally { await c.close(); }
  }, 60_000);

  it('writes dom.json next to each PNG', async () => {
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
      const v = r.viewportResults[0]!;
      const originDomPath = v.originPath.replace(/origin\.png$/, 'origin.dom.json');
      const targetDomPath = v.targetPath.replace(/target\.png$/, 'target.dom.json');
      expect(existsSync(originDomPath)).toBe(true);
      expect(existsSync(targetDomPath)).toBe(true);
      const originDom = JSON.parse(readFileSync(originDomPath, 'utf-8'));
      expect(originDom.elements.length).toBeGreaterThan(0);
    } finally { await c.close(); }
  }, 60_000);
});
