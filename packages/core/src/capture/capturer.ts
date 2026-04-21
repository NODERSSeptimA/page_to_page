import { chromium, type Browser, type BrowserContext, type Page as PwPage } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ViewportSpec } from '../types.js';
import { STABILIZE_INIT_SCRIPT, stabilizeStyleTag } from './stabilize.js';
import { buildMaskScript } from './mask.js';
import { captureDomSnapshot } from './dom-snapshot.js';

export interface CaptureInput {
  originUrl: string;
  targetUrl: string;
  pagePath: string;
  viewports: ReadonlyArray<ViewportSpec>;
  maskSelectors: ReadonlyArray<string>;
  artifactsDir: string;
  storageStatePath?: string;
  /** networkidle wait ms after load. Default: 5000. Use 0 to skip. */
  idleTimeoutMs?: number;
  /** Wait for this CSS selector before screenshot. For SPAs whose data-driven content arrives after networkidle. */
  waitForSelector?: string;
}

export interface CaptureViewportResult {
  viewport: string;
  originPath: string;
  targetPath: string;
  originError?: string;
  targetError?: string;
}

export interface CaptureResult {
  pagePath: string;
  viewportResults: CaptureViewportResult[];
}

export class PageCapturer {
  private constructor(private readonly browser: Browser, private readonly concurrency: number) {}

  static async launch(opts: { concurrency?: number } = {}): Promise<PageCapturer> {
    const browser = await chromium.launch({ headless: true });
    return new PageCapturer(browser, opts.concurrency ?? 4);
  }

  async close(): Promise<void> { await this.browser.close(); }

  async capturePage(input: CaptureInput): Promise<CaptureResult> {
    const slug = slugify(input.pagePath);
    const baseDir = resolve(input.artifactsDir, slug);
    mkdirSync(baseDir, { recursive: true });
    const tasks = input.viewports.map((vp) => async () => {
      const vpDir = join(baseDir, vp.name);
      mkdirSync(vpDir, { recursive: true });
      const originPath = join(vpDir, 'origin.png');
      const targetPath = join(vpDir, 'target.png');
      const common = {
        viewport: vp,
        maskSelectors: input.maskSelectors,
        storageStatePath: input.storageStatePath,
        idleTimeoutMs: input.idleTimeoutMs,
        waitForSelector: input.waitForSelector,
      };
      const [oErr, tErr] = await Promise.all([
        this.captureSite({ ...common, url: joinUrl(input.originUrl, input.pagePath), output: originPath }),
        this.captureSite({ ...common, url: joinUrl(input.targetUrl, input.pagePath), output: targetPath }),
      ]);
      return { viewport: vp.name, originPath, targetPath, originError: oErr, targetError: tErr };
    });
    const results = await runPooled(tasks, this.concurrency);
    return { pagePath: input.pagePath, viewportResults: results };
  }

  private async captureSite(opts: {
    url: string; viewport: ViewportSpec; output: string;
    maskSelectors: ReadonlyArray<string>; storageStatePath?: string;
    idleTimeoutMs?: number;
    waitForSelector?: string;
  }): Promise<string | undefined> {
    const idleTimeoutMs = opts.idleTimeoutMs ?? 5_000;
    let ctx: BrowserContext | undefined; let page: PwPage | undefined;
    try {
      ctx = await this.browser.newContext({
        viewport: { width: opts.viewport.width, height: opts.viewport.height },
        storageState: opts.storageStatePath,
      });
      await ctx.addInitScript(STABILIZE_INIT_SCRIPT);
      page = await ctx.newPage();
      const response = await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 30_000 });
      if (!response) return 'no response';
      if (response.status() >= 400) return `HTTP ${response.status()}`;
      await page.addStyleTag({ content: stabilizeStyleTag() });
      const maskScript = buildMaskScript(opts.maskSelectors);
      if (maskScript) await page.evaluate(maskScript);
      if (idleTimeoutMs > 0) {
        await page.waitForLoadState('networkidle', { timeout: idleTimeoutMs }).catch(() => { /* best-effort */ });
      }
      if (opts.waitForSelector) {
        // Selector timeout tracks idleTimeoutMs * 2 to give data-driven content room,
        // capped at 30s to bound overall per-viewport time.
        const selectorTimeoutMs = Math.min(Math.max(idleTimeoutMs * 2, 10_000), 30_000);
        await page.waitForSelector(opts.waitForSelector, { timeout: selectorTimeoutMs, state: 'visible' });
      }
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      writeFileSync(opts.output, png);
      // Capture DOM snapshot alongside screenshot (name inferred from filename: origin.png → origin.dom.json)
      const domPath = opts.output.replace(/\.png$/, '.dom.json');
      try {
        const snap = await captureDomSnapshot(page, {
          pagePath: new URL(opts.url).pathname,
          viewport: opts.viewport.name,
        });
        writeFileSync(domPath, JSON.stringify(snap));
      } catch (err) {
        writeFileSync(domPath, JSON.stringify({
          pagePath: new URL(opts.url).pathname, viewport: opts.viewport.name,
          elements: [], capturedAt: new Date().toISOString(),
          error: `DOM snapshot failed: ${(err as Error).message}`,
        }));
      }
      return undefined;
    } catch (err) { return (err as Error).message; }
    finally {
      await page?.close().catch(() => {});
      await ctx?.close().catch(() => {});
    }
  }
}

function slugify(p: string): string {
  return p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '__');
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

async function runPooled<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const n = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  });
  await Promise.all(workers);
  return results;
}
