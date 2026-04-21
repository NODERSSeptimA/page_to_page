import type { Page as PwPage } from 'playwright';
import type { DomSnapshot } from '../types.js';

export interface CaptureDomSnapshotOptions {
  pagePath: string;
  viewport: string;
  maxElements?: number;
}

const WHITELIST_ATTRS = ['id', 'class', 'role', 'aria-label', 'aria-labelledby', 'alt', 'title', 'name', 'data-testid'];

const STYLE_PROPS = [
  'font-family','font-size','font-weight','font-style',
  'line-height','letter-spacing','text-transform','text-align','text-decoration',
  'color','background-color','background-image','opacity',
  'padding-top','padding-right','padding-bottom','padding-left',
  'margin-top','margin-right','margin-bottom','margin-left',
  'border-top','border-right','border-bottom','border-left','border-radius',
  'width','height','min-width','min-height','max-width','max-height',
  'display','position',
  'flex-direction','justify-content','align-items','gap',
  'box-shadow','transform',
];

type DomElementOut = {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  bbox: { x: number; y: number; width: number; height: number };
  computedStyles: Record<string, string>;
  parentIndex: number;
};

type EvaluateArgs = {
  whitelistAttrs: readonly string[];
  styleProps: readonly string[];
  max: number;
};

type EvaluateResult = {
  out: DomElementOut[];
  truncated: boolean;
};

export async function captureDomSnapshot(
  page: PwPage,
  opts: CaptureDomSnapshotOptions,
): Promise<DomSnapshot> {
  const maxElements = opts.maxElements ?? 15_000;
  const capturedAt = new Date().toISOString();
  try {
    const result = await page.evaluate<EvaluateResult, EvaluateArgs>(
      ({ whitelistAttrs, styleProps, max }) => {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        // The body of this function executes in the browser context where DOM
        // globals are available. We access them via (globalThis as any) to avoid
        // TypeScript errors caused by the project's "lib": ["ES2023"] config.
        const gw = globalThis as any;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const root: unknown = gw.document.documentElement;
        const list: unknown[] = [root];
        const parents: number[] = [-1];
        const out: DomElementOut[] = [];
        let truncated = false;

        while (list.length > 0 && out.length < max) {
          const node = list.shift();
          const parentIdx = parents.shift()!;
          // In browser context, node is always an Element here.
          const el = node as any;
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const rect: { x: number; y: number; width: number; height: number } = el.getBoundingClientRect();
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const cs: { getPropertyValue: (p: string) => string } = gw.getComputedStyle(el);
          const attrs: Record<string, string> = {};
          for (const a of whitelistAttrs) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call
            const v: string | null = el.getAttribute(a);
            if (v != null) attrs[a] = v;
          }
          const styles: Record<string, string> = {};
          for (const p of styleProps) styles[p] = cs.getPropertyValue(p).trim();
          const selfIndex = out.length;
          out.push({
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            tag: (el.tagName as string).toLowerCase(),
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            text: ((el.textContent as string | null) ?? '').slice(0, 200).trim(),
            attrs,
            bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles: styles,
            parentIndex: parentIdx,
          });
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          for (const child of Array.from(el.children as ArrayLike<unknown>)) {
            list.push(child);
            parents.push(selfIndex);
          }
        }
        if (list.length > 0) truncated = true;
        return { out, truncated };
        /* eslint-enable @typescript-eslint/no-explicit-any */
      },
      { whitelistAttrs: WHITELIST_ATTRS, styleProps: STYLE_PROPS, max: maxElements },
    );
    const snapshot: DomSnapshot = {
      pagePath: opts.pagePath,
      viewport: opts.viewport,
      elements: result.out,
      capturedAt,
    };
    if (result.truncated) snapshot.truncated = true;
    return snapshot;
  } catch (err) {
    return {
      pagePath: opts.pagePath,
      viewport: opts.viewport,
      elements: [],
      capturedAt,
      error: (err as Error).message,
    };
  }
}
