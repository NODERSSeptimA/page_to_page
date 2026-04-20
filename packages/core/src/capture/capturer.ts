import { chromium, type Browser, type BrowserContext, type Page as PwPage } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ViewportSpec } from '../types.js';
import { STABILIZE_INIT_SCRIPT, stabilizeStyleTag } from './stabilize.js';
import { buildMaskScript } from './mask.js';

export interface CaptureInput {
  originUrl: string;
  targetUrl: string;
  pagePath: string;
  viewports: ReadonlyArray<ViewportSpec>;
  maskSelectors: ReadonlyArray<string>;
  artifactsDir: string;
  storageStatePath?: string;
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
      const [oErr, tErr] = await Promise.all([
        this.captureSite({ url: joinUrl(input.originUrl, input.pagePath), viewport: vp, output: originPath, maskSelectors: input.maskSelectors, storageStatePath: input.storageStatePath }),
        this.captureSite({ url: joinUrl(input.targetUrl, input.pagePath), viewport: vp, output: targetPath, maskSelectors: input.maskSelectors, storageStatePath: input.storageStatePath }),
      ]);
      return { viewport: vp.name, originPath, targetPath, originError: oErr, targetError: tErr };
    });
    const results = await runPooled(tasks, this.concurrency);
    return { pagePath: input.pagePath, viewportResults: results };
  }

  private async captureSite(opts: {
    url: string; viewport: ViewportSpec; output: string;
    maskSelectors: ReadonlyArray<string>; storageStatePath?: string;
  }): Promise<string | undefined> {
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
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => { /* best-effort */ });
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      writeFileSync(opts.output, png);
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
