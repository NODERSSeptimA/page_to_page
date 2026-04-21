import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { captureDomSnapshot } from './dom-snapshot.js';

describe('captureDomSnapshot', () => {
  let browser: Browser; let ctx: BrowserContext;
  let server: Server; let baseUrl: string;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    const app = express();
    app.get('/t', (_req, res) => res.type('html').send(`
      <!doctype html><html><body>
        <h1 id="hero" class="big">Welcome</h1>
        <p aria-label="intro">Hello</p>
        <img alt="logo" src="about:blank">
      </body></html>`));
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.on('listening', r));
    const port = (server.address() as AddressInfo).port;
    baseUrl = `http://127.0.0.1:${port}`;
  }, 30_000);

  afterAll(async () => {
    await ctx.close(); await browser.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('captures elements with tag, text, attrs, bbox, styles', async () => {
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}/t`, { waitUntil: 'networkidle' });
    const snap = await captureDomSnapshot(page, { pagePath: '/t', viewport: 'desktop' });
    await page.close();

    expect(snap.elements.length).toBeGreaterThan(0);
    const h1 = snap.elements.find((e) => e.tag === 'h1');
    expect(h1).toBeDefined();
    expect(h1!.text).toBe('Welcome');
    expect(h1!.attrs.id).toBe('hero');
    expect(h1!.attrs.class).toBe('big');
    expect(h1!.bbox.width).toBeGreaterThan(0);
    expect(h1!.computedStyles['font-size']).toBeDefined();

    const p = snap.elements.find((e) => e.tag === 'p');
    expect(p!.attrs['aria-label']).toBe('intro');
    const img = snap.elements.find((e) => e.tag === 'img');
    expect(img!.attrs.alt).toBe('logo');
  }, 30_000);

  it('respects soft cap and sets truncated', async () => {
    // Build a page with many nodes
    const app2 = express();
    app2.get('/big', (_req, res) => {
      const divs = Array.from({ length: 20_000 }, (_, i) => `<div data-i="${i}"></div>`).join('');
      res.type('html').send(`<!doctype html><html><body>${divs}</body></html>`);
    });
    const s2 = app2.listen(0, '127.0.0.1');
    await new Promise<void>((r) => s2.on('listening', r));
    const p2 = (s2.address() as AddressInfo).port;
    const page = await ctx.newPage();
    try {
      await page.goto(`http://127.0.0.1:${p2}/big`, { waitUntil: 'networkidle' });
      const snap = await captureDomSnapshot(page, { pagePath: '/big', viewport: 'desktop' });
      expect(snap.elements.length).toBeLessThanOrEqual(15_000);
      expect(snap.truncated).toBe(true);
    } finally {
      await page.close();
      await new Promise<void>((r) => s2.close(() => r()));
    }
  }, 60_000);
});
