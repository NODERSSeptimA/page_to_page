# page_to_page Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pixel-first DOM analysis on top of Phase 1 — cluster diff regions, look up elements at coordinates via offline DOM snapshots, compare computed styles, emit structured `FixProposal[]` via new MCP tool `get_fix_proposals()`.

**Architecture:** Five new pure(-ish) modules in `packages/core/src/` — `capture/dom-snapshot.ts`, `diff/clusters.ts`, `analysis/element-at-point.ts`, `analysis/style-compare.ts`, `analysis/fix-proposals.ts`. `PageCapturer` extended to write `<side>.dom.json`. `MigrationEngine.diffPath()` extended to run cluster + proposal generation. New MCP tool in `packages/mcp-server`. Test fixtures extended with one page per FixProposal kind.

**Tech Stack:** No new external deps. Reuses `playwright`, `pngjs`, `zod` from Phase 1. Flood-fill and offline elementAtPoint are bespoke code.

**Scope boundaries:**
- In: DomSnapshotter, ClusterExtractor (flood-fill + merge), ElementAtPoint (offline), StyleComparator, FixProposalGenerator, `get_fix_proposals` tool, extended fixtures, E2E, README update
- Out (Phase 2.1): `get_fix_proposals({regenerate: true})` — regenerate without re-capture
- Out (future): auto-apply, design-token awareness, iframe support, tree-wise DOM diff

---

## File structure

```
packages/core/src/
  types.ts                       # extended: Cluster, DomSnapshot, Element, StyleDiff, FixProposal types
  index.ts                       # extended: exports for above + new modules
  capture/
    dom-snapshot.ts              # NEW: capture DOM via page.evaluate
    capturer.ts                  # MODIFIED: write <side>.dom.json after screenshot
  diff/
    clusters.ts                  # NEW: flood-fill + merge, pure on PNG buffer
  analysis/
    element-at-point.ts          # NEW: offline elementAtPoint over DomSnapshot
    style-compare.ts             # NEW: whitelisted computed-style diff
    fix-proposals.ts             # NEW: orchestrator over snapshots + clusters + PNGs
  engine/
    migration.ts                 # MODIFIED: diffPath writes clusters + proposals

packages/mcp-server/src/
  server.ts                      # MODIFIED: add 'get_fix_proposals' switch case
  tools/
    fix-proposals.ts             # NEW: handleGetFixProposals
  index.ts                       # MODIFIED: add to TOOLS array

test-fixtures/
  pages.ts                       # MODIFIED: add pages for style_mismatch + missing_block

docs/superpowers/
  plans/2026-04-21-page-to-page-phase2.md     # this file
```

---

## Task 1: Extend shared types

**Files:**
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/src/types-phase2.test.ts`

- [ ] **Step 1: Write failing test `packages/core/src/types-phase2.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type {
  Cluster, DomSnapshot, DomElement, StyleDiff,
  FixProposal, StyleMismatchProposal, MissingBlockProposal, UnknownProposal,
} from './types.js';

describe('phase 2 types', () => {
  it('Cluster shape', () => {
    const c: Cluster = { id: 'c-1', bbox: { x: 0, y: 0, width: 10, height: 10 }, pixelCount: 50 };
    expect(c.id).toBe('c-1');
  });
  it('DomSnapshot with elements', () => {
    const el: DomElement = {
      tag: 'h1', text: 'Hi', attrs: {},
      bbox: { x: 0, y: 0, width: 100, height: 40 },
      computedStyles: { 'font-size': '32px' }, parentIndex: -1,
    };
    const s: DomSnapshot = {
      pagePath: '/', viewport: 'desktop',
      elements: [el], capturedAt: new Date().toISOString(),
    };
    expect(s.elements).toHaveLength(1);
  });
  it('StyleDiff shape', () => {
    const d: StyleDiff = { property: 'font-size', origin: '32px', target: '28px' };
    expect(d.property).toBe('font-size');
  });
  it('StyleMismatchProposal discriminator', () => {
    const p: StyleMismatchProposal = {
      kind: 'style_mismatch', clusterId: 'c-1', viewport: 'desktop',
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      originCropPath: 'o.png', targetCropPath: 't.png',
      styleDiffs: [{ property: 'color', origin: 'red', target: 'blue' }],
      suggestedSearchTerms: ['Hi'],
    };
    const fp: FixProposal = p;
    if (fp.kind === 'style_mismatch') expect(fp.styleDiffs).toHaveLength(1);
  });
  it('MissingBlockProposal discriminator', () => {
    const p: MissingBlockProposal = {
      kind: 'missing_block', clusterId: 'c-2', viewport: 'mobile',
      bbox: { x: 0, y: 0, width: 50, height: 50 },
      originCropPath: 'o.png', targetCropPath: 't.png',
      side: 'origin_only',
      missingElementSummary: 'h2 with text "Team"',
      suggestedSearchTerms: ['Team'],
    };
    expect(p.side).toBe('origin_only');
  });
  it('UnknownProposal discriminator', () => {
    const p: UnknownProposal = {
      kind: 'unknown', clusterId: 'c-3', viewport: 'desktop',
      bbox: { x: 0, y: 0, width: 10, height: 10 },
      originCropPath: 'o.png', targetCropPath: 't.png',
      warning: 'no element found',
      suggestedSearchTerms: [],
    };
    expect(p.warning).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/types-phase2.test.ts
```

- [ ] **Step 3: Append to `packages/core/src/types.ts`**

```ts
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
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run packages/core/src/types-phase2.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/types.ts packages/core/src/types-phase2.test.ts
git commit -m "feat(core): phase 2 shared types (Cluster, DomSnapshot, FixProposal)"
```

---

## Task 2: ClusterExtractor (flood-fill + merge)

**Files:**
- Create: `packages/core/src/diff/clusters.ts`, `packages/core/src/diff/clusters.test.ts`

- [ ] **Step 1: Write failing test `packages/core/src/diff/clusters.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { extractClusters } from './clusters.js';

function makePng(width: number, height: number, redPixels: Array<[number, number]>): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (const [x, y] of redPixels) {
    const idx = (width * y + x) * 4;
    png.data[idx] = 255; png.data[idx+1] = 0; png.data[idx+2] = 0; png.data[idx+3] = 255;
  }
  return PNG.sync.write(png);
}

describe('extractClusters', () => {
  it('empty diff returns []', () => {
    const buf = makePng(20, 20, []);
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 })).toEqual([]);
  });

  it('single red pixel becomes one cluster (ignoring minArea)', () => {
    const buf = makePng(20, 20, [[5, 5]]);
    const clusters = extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.bbox).toEqual({ x: 5, y: 5, width: 1, height: 1 });
    expect(clusters[0]!.pixelCount).toBe(1);
  });

  it('single pixel filtered out by minClusterArea', () => {
    const buf = makePng(20, 20, [[5, 5]]);
    expect(extractClusters(buf, { minClusterArea: 2, mergeDistance: 0 })).toEqual([]);
  });

  it('contiguous pixels form one cluster', () => {
    const pts: Array<[number, number]> = [[2,2],[3,2],[2,3],[3,3]]; // 2x2 block
    const buf = makePng(20, 20, pts);
    const clusters = extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.bbox).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(clusters[0]!.pixelCount).toBe(4);
  });

  it('two disjoint clusters far apart stay separate', () => {
    const buf = makePng(40, 40, [[2,2],[30,30]]);
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 5 })).toHaveLength(2);
  });

  it('two disjoint clusters merge when within mergeDistance', () => {
    const buf = makePng(40, 40, [[2,2],[10,2]]); // gap of 7 px in x
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 10 })).toHaveLength(1);
  });

  it('cluster ids are c-1, c-2, ...', () => {
    const buf = makePng(40, 40, [[2,2],[30,30]]);
    const cs = extractClusters(buf, { minClusterArea: 1, mergeDistance: 5 });
    const ids = cs.map((c) => c.id).sort();
    expect(ids).toEqual(['c-1', 'c-2']);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/diff/clusters.test.ts
```

- [ ] **Step 3: Write `packages/core/src/diff/clusters.ts`**

```ts
import { PNG } from 'pngjs';
import type { Cluster, Bbox } from '../types.js';

export interface ExtractClustersOptions {
  mergeDistance?: number;   // default 30
  minClusterArea?: number;  // default 64
}

export function extractClusters(diffPngBuffer: Buffer, opts: ExtractClustersOptions = {}): Cluster[] {
  const mergeDistance = opts.mergeDistance ?? 30;
  const minClusterArea = opts.minClusterArea ?? 64;
  const png = PNG.sync.read(diffPngBuffer);
  const { width, height, data } = png;
  const seen = new Uint8Array(width * height);

  const isRed = (x: number, y: number): boolean => {
    const i = (width * y + x) * 4;
    return (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) && data[i + 3]! > 0;
  };

  const rawBoxes: Array<{ bbox: Bbox; pixelCount: number }> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = width * y + x;
      if (seen[idx] || !isRed(x, y)) continue;
      // BFS flood fill
      const queue: Array<[number, number]> = [[x, y]];
      let minX = x, minY = y, maxX = x, maxY = y, count = 0;
      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const ci = width * cy + cx;
        if (seen[ci]) continue;
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        if (!isRed(cx, cy)) continue;
        seen[ci] = 1; count++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      rawBoxes.push({
        bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        pixelCount: count,
      });
    }
  }

  // Merge close boxes
  const merged = mergeBoxes(rawBoxes, mergeDistance);
  // Filter by minClusterArea (pixel count)
  const filtered = merged.filter((m) => m.pixelCount >= minClusterArea);
  return filtered.map((m, i) => ({ id: `c-${i + 1}`, bbox: m.bbox, pixelCount: m.pixelCount }));
}

function mergeBoxes(
  boxes: Array<{ bbox: Bbox; pixelCount: number }>,
  maxDistance: number,
): Array<{ bbox: Bbox; pixelCount: number }> {
  const remaining = [...boxes];
  const result: Array<{ bbox: Bbox; pixelCount: number }> = [];
  while (remaining.length > 0) {
    let current = remaining.shift()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        if (bboxDistance(current.bbox, remaining[i]!.bbox) <= maxDistance) {
          current = {
            bbox: unionBbox(current.bbox, remaining[i]!.bbox),
            pixelCount: current.pixelCount + remaining[i]!.pixelCount,
          };
          remaining.splice(i, 1);
          i--;
          changed = true;
        }
      }
    }
    result.push(current);
  }
  return result;
}

function bboxDistance(a: Bbox, b: Bbox): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return dx + dy;
}

function unionBbox(a: Bbox, b: Bbox): Bbox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}
```

- [ ] **Step 4: Run — expect PASS (7/7)**

```bash
npx vitest run packages/core/src/diff/clusters.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/diff/clusters.ts packages/core/src/diff/clusters.test.ts
git commit -m "feat(core): cluster extraction via flood-fill + merge"
```

---

## Task 3: ElementAtPoint (offline lookup)

**Files:**
- Create: `packages/core/src/analysis/element-at-point.ts`, `packages/core/src/analysis/element-at-point.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/analysis/element-at-point.test.ts
import { describe, it, expect } from 'vitest';
import { elementAtPoint } from './element-at-point.js';
import type { DomSnapshot, DomElement } from '../types.js';

function el(overrides: Partial<DomElement>): DomElement {
  return {
    tag: 'div', text: '', attrs: {},
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    computedStyles: {}, parentIndex: -1,
    ...overrides,
  };
}

function snap(elements: DomElement[]): DomSnapshot {
  return { pagePath: '/', viewport: 'desktop', elements, capturedAt: '2026-04-21T00:00:00Z' };
}

describe('elementAtPoint', () => {
  it('returns undefined when no element contains point', () => {
    const s = snap([el({ bbox: { x: 100, y: 100, width: 10, height: 10 } })]);
    expect(elementAtPoint(s, { x: 5, y: 5 })).toBeUndefined();
  });

  it('returns the only element containing the point', () => {
    const s = snap([el({ bbox: { x: 0, y: 0, width: 50, height: 50 } })]);
    expect(elementAtPoint(s, { x: 5, y: 5 })).toBe(0);
  });

  it('picks the deepest element when nested', () => {
    // 0 = body (parent -1); 1 = nested child
    const parent = el({ tag: 'body', bbox: { x: 0, y: 0, width: 100, height: 100 } });
    const child = el({ tag: 'h1', bbox: { x: 10, y: 10, width: 20, height: 10 }, parentIndex: 0 });
    const s = snap([parent, child]);
    expect(elementAtPoint(s, { x: 15, y: 12 })).toBe(1);
  });

  it('tie-breaks by smaller bbox area when depth equal', () => {
    const a = el({ tag: 'div', bbox: { x: 0, y: 0, width: 100, height: 100 }, parentIndex: -1 });
    const b = el({ tag: 'span', bbox: { x: 0, y: 0, width: 20, height: 20 }, parentIndex: -1 });
    const s = snap([a, b]);
    expect(elementAtPoint(s, { x: 5, y: 5 })).toBe(1); // span is smaller
  });

  it('half-open edges: right/bottom excluded', () => {
    const a = el({ bbox: { x: 0, y: 0, width: 10, height: 10 } });
    const s = snap([a]);
    expect(elementAtPoint(s, { x: 10, y: 5 })).toBeUndefined();  // x=10 outside
    expect(elementAtPoint(s, { x: 9, y: 9 })).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/analysis/element-at-point.test.ts
```

- [ ] **Step 3: Write `packages/core/src/analysis/element-at-point.ts`**

```ts
import type { DomSnapshot } from '../types.js';

export interface Point { x: number; y: number }

export function elementAtPoint(snapshot: DomSnapshot, point: Point): number | undefined {
  const candidates: Array<{ index: number; depth: number; area: number }> = [];
  for (let i = 0; i < snapshot.elements.length; i++) {
    const e = snapshot.elements[i]!;
    const { x, y, width, height } = e.bbox;
    if (point.x < x || point.x >= x + width) continue;
    if (point.y < y || point.y >= y + height) continue;
    candidates.push({ index: i, depth: depthOf(snapshot, i), area: width * height });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth; // deeper first
    return a.area - b.area;                             // smaller area first
  });
  return candidates[0]!.index;
}

function depthOf(snapshot: DomSnapshot, index: number): number {
  let depth = 0;
  let cur = index;
  while (cur !== -1 && depth < 10000) {
    const parent = snapshot.elements[cur]?.parentIndex ?? -1;
    if (parent === -1) break;
    cur = parent;
    depth++;
  }
  return depth;
}
```

- [ ] **Step 4: Run — expect PASS (5/5)**

```bash
npx vitest run packages/core/src/analysis/element-at-point.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/analysis/element-at-point.ts packages/core/src/analysis/element-at-point.test.ts
git commit -m "feat(core): offline elementAtPoint over DomSnapshot"
```

---

## Task 4: StyleComparator

**Files:**
- Create: `packages/core/src/analysis/style-compare.ts`, `packages/core/src/analysis/style-compare.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/analysis/style-compare.test.ts
import { describe, it, expect } from 'vitest';
import { compareStyles, STYLE_WHITELIST } from './style-compare.js';
import type { DomElement } from '../types.js';

function elWith(styles: Record<string, string>): DomElement {
  return {
    tag: 'div', text: '', attrs: {},
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    computedStyles: styles, parentIndex: -1,
  };
}

describe('compareStyles', () => {
  it('returns empty array when all properties equal', () => {
    const a = elWith({ 'font-size': '16px', color: 'rgb(0, 0, 0)' });
    const b = elWith({ 'font-size': '16px', color: 'rgb(0, 0, 0)' });
    expect(compareStyles(a, b)).toEqual([]);
  });

  it('reports property that differs', () => {
    const a = elWith({ 'font-size': '56px' });
    const b = elWith({ 'font-size': '48px' });
    const r = compareStyles(a, b);
    expect(r).toEqual([{ property: 'font-size', origin: '56px', target: '48px' }]);
  });

  it('normalizes hex vs rgb for color', () => {
    const a = elWith({ color: '#ff0000' });
    const b = elWith({ color: 'rgb(255, 0, 0)' });
    expect(compareStyles(a, b)).toEqual([]);
  });

  it('treats missing-on-one-side as a diff with empty string', () => {
    const a = elWith({ padding: '10px' });
    const b = elWith({});
    const r = compareStyles(a, b);
    expect(r.some((d) => d.property === 'padding' && d.origin === '10px' && d.target === '')).toBe(true);
  });

  it('ignores properties outside whitelist', () => {
    const a = elWith({ 'font-size': '16px', 'writing-mode': 'lr-tb' });
    const b = elWith({ 'font-size': '16px', 'writing-mode': 'rl-tb' });
    expect(compareStyles(a, b)).toEqual([]);
  });

  it('whitelist includes core typography + box properties', () => {
    expect(STYLE_WHITELIST).toContain('font-size');
    expect(STYLE_WHITELIST).toContain('color');
    expect(STYLE_WHITELIST).toContain('padding-top');
    expect(STYLE_WHITELIST).toContain('display');
    expect(STYLE_WHITELIST).toContain('box-shadow');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/analysis/style-compare.test.ts
```

- [ ] **Step 3: Write `packages/core/src/analysis/style-compare.ts`**

```ts
import type { DomElement, StyleDiff } from '../types.js';

export const STYLE_WHITELIST: ReadonlyArray<string> = Object.freeze([
  'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-transform', 'text-align', 'text-decoration',
  'color', 'background-color', 'background-image', 'opacity',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'display', 'position',
  'flex-direction', 'justify-content', 'align-items', 'gap',
  'box-shadow', 'transform',
]);

export function compareStyles(origin: DomElement, target: DomElement): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  for (const prop of STYLE_WHITELIST) {
    const a = normalize(prop, origin.computedStyles[prop] ?? '');
    const b = normalize(prop, target.computedStyles[prop] ?? '');
    if (a !== b) {
      diffs.push({
        property: prop,
        origin: origin.computedStyles[prop] ?? '',
        target: target.computedStyles[prop] ?? '',
      });
    }
  }
  return diffs;
}

function normalize(prop: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') return '';
  // Color normalization for any color-ish property
  if (/color/i.test(prop) || prop === 'background-image') {
    return canonicalizeColorish(trimmed);
  }
  return trimmed;
}

function canonicalizeColorish(value: string): string {
  // Hex → rgb canonical
  const hex = value.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1]!;
    if (h.length === 3) {
      const r = parseInt(h[0]! + h[0]!, 16);
      const g = parseInt(h[1]! + h[1]!, 16);
      const b = parseInt(h[2]! + h[2]!, 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    if (h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = parseInt(h.slice(6, 8), 16) / 255;
      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3).replace(/\.?0+$/, '')})`;
    }
  }
  // rgb(255,0,0) vs rgb(255, 0, 0) — canonicalize spacing
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1]!.split(',').map((s) => s.trim());
    return `${value.startsWith('rgba') ? 'rgba' : 'rgb'}(${parts.join(', ')})`;
  }
  return value;
}
```

- [ ] **Step 4: Run — expect PASS (6/6)**

```bash
npx vitest run packages/core/src/analysis/style-compare.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/analysis/style-compare.ts packages/core/src/analysis/style-compare.test.ts
git commit -m "feat(core): style comparator with color canonicalization"
```

---

## Task 5: DomSnapshotter (browser-side capture)

**Files:**
- Create: `packages/core/src/capture/dom-snapshot.ts`, `packages/core/src/capture/dom-snapshot.test.ts`

- [ ] **Step 1: Write failing test (uses Playwright + fixture HTML)**

```ts
// packages/core/src/capture/dom-snapshot.test.ts
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/capture/dom-snapshot.test.ts
```

- [ ] **Step 3: Write `packages/core/src/capture/dom-snapshot.ts`**

```ts
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

export async function captureDomSnapshot(
  page: PwPage,
  opts: CaptureDomSnapshotOptions,
): Promise<DomSnapshot> {
  const maxElements = opts.maxElements ?? 15_000;
  const capturedAt = new Date().toISOString();
  try {
    const result = await page.evaluate(
      ({ whitelistAttrs, styleProps, max }) => {
        const root = document.documentElement;
        const list: Array<Node> = [root];
        const parents: Array<number> = [-1];
        const out: Array<{
          tag: string; text: string; attrs: Record<string, string>;
          bbox: { x: number; y: number; width: number; height: number };
          computedStyles: Record<string, string>;
          parentIndex: number;
        }> = [];
        let truncated = false;
        while (list.length > 0 && out.length < max) {
          const node = list.shift()!;
          const parentIdx = parents.shift()!;
          if (!(node instanceof Element)) continue;
          const el = node as Element;
          const rect = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          const attrs: Record<string, string> = {};
          for (const a of whitelistAttrs) {
            const v = el.getAttribute(a);
            if (v != null) attrs[a] = v;
          }
          const styles: Record<string, string> = {};
          for (const p of styleProps) styles[p] = cs.getPropertyValue(p).trim();
          const selfIndex = out.length;
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent ?? '').slice(0, 200).trim(),
            attrs,
            bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            computedStyles: styles,
            parentIndex: parentIdx,
          });
          for (const child of Array.from(el.children)) {
            list.push(child);
            parents.push(selfIndex);
          }
        }
        if (list.length > 0) truncated = true;
        return { out, truncated };
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
```

- [ ] **Step 4: Run — expect PASS (2/2)**

```bash
npx vitest run packages/core/src/capture/dom-snapshot.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/capture/dom-snapshot.ts packages/core/src/capture/dom-snapshot.test.ts
git commit -m "feat(core): DomSnapshotter (browser-side capture with soft cap)"
```

---

## Task 6: FixProposalGenerator (orchestrator)

**Files:**
- Create: `packages/core/src/analysis/fix-proposals.ts`, `packages/core/src/analysis/fix-proposals.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/analysis/fix-proposals.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { generateFixProposals } from './fix-proposals.js';
import type { DomSnapshot, DomElement, Cluster } from '../types.js';

function snap(pagePath: string, viewport: string, elements: DomElement[]): DomSnapshot {
  return { pagePath, viewport, elements, capturedAt: '2026-04-21T00:00:00Z' };
}

function solidPng(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (w * y + x) * 4;
    png.data[i] = rgba[0]; png.data[i+1] = rgba[1]; png.data[i+2] = rgba[2]; png.data[i+3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe('generateFixProposals', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-fp-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('produces style_mismatch when both sides have real matching element', async () => {
    const origin = snap('/', 'desktop', [
      { tag: 'body', text: '', attrs: {}, bbox: { x:0, y:0, width:100, height:100 }, computedStyles: {}, parentIndex: -1 },
      { tag: 'h1', text: 'Hi', attrs: {}, bbox: { x:10, y:10, width:50, height:30 }, computedStyles: { 'font-size': '56px', color: 'rgb(0, 0, 0)' }, parentIndex: 0 },
    ]);
    const target = snap('/', 'desktop', [
      { tag: 'body', text: '', attrs: {}, bbox: { x:0, y:0, width:100, height:100 }, computedStyles: {}, parentIndex: -1 },
      { tag: 'h1', text: 'Hi', attrs: {}, bbox: { x:10, y:10, width:50, height:30 }, computedStyles: { 'font-size': '48px', color: 'rgb(0, 0, 0)' }, parentIndex: 0 },
    ]);
    const clusters: Cluster[] = [{ id: 'c-1', bbox: { x: 10, y: 10, width: 40, height: 20 }, pixelCount: 200 }];
    const originPng = solidPng(100, 100, [255, 255, 255, 255]);
    const targetPng = solidPng(100, 100, [255, 255, 255, 255]);
    const diffPng = solidPng(100, 100, [255, 0, 0, 255]);

    const proposals = await generateFixProposals({
      viewport: 'desktop',
      originSnapshot: origin,
      targetSnapshot: target,
      clusters,
      originPng, targetPng, diffPng,
      artifactsDir: dir,
    });
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.kind).toBe('style_mismatch');
    if (p.kind !== 'style_mismatch') throw new Error('unreachable');
    expect(p.styleDiffs.some((d) => d.property === 'font-size')).toBe(true);
    expect(existsSync(p.originCropPath)).toBe(true);
    expect(existsSync(p.targetCropPath)).toBe(true);
  });

  it('produces missing_block when target side has only body/oversized element', async () => {
    const origin = snap('/', 'desktop', [
      { tag: 'body', text: '', attrs: {}, bbox: { x:0, y:0, width:100, height:100 }, computedStyles: {}, parentIndex: -1 },
      { tag: 'section', text: 'Team', attrs: { class: 'team' }, bbox: { x:10, y:10, width:80, height:50 }, computedStyles: {}, parentIndex: 0 },
    ]);
    const target = snap('/', 'desktop', [
      { tag: 'body', text: '', attrs: {}, bbox: { x:0, y:0, width:100, height:100 }, computedStyles: {}, parentIndex: -1 },
    ]);
    const clusters: Cluster[] = [{ id: 'c-1', bbox: { x: 10, y: 10, width: 80, height: 50 }, pixelCount: 4000 }];
    const pngs = solidPng(100, 100, [255, 255, 255, 255]);
    const diff = solidPng(100, 100, [255, 0, 0, 255]);
    const proposals = await generateFixProposals({
      viewport: 'desktop',
      originSnapshot: origin, targetSnapshot: target,
      clusters, originPng: pngs, targetPng: pngs, diffPng: diff,
      artifactsDir: dir,
    });
    expect(proposals).toHaveLength(1);
    const p = proposals[0]!;
    expect(p.kind).toBe('missing_block');
    if (p.kind !== 'missing_block') throw new Error('unreachable');
    expect(p.side).toBe('origin_only');
    expect(p.missingElementSummary).toMatch(/section/);
  });

  it('produces unknown when neither side has element at cluster', async () => {
    const empty = snap('/', 'desktop', []);
    const clusters: Cluster[] = [{ id: 'c-1', bbox: { x: 10, y: 10, width: 10, height: 10 }, pixelCount: 50 }];
    const pngs = solidPng(100, 100, [255, 255, 255, 255]);
    const diff = solidPng(100, 100, [255, 0, 0, 255]);
    const proposals = await generateFixProposals({
      viewport: 'desktop',
      originSnapshot: empty, targetSnapshot: empty,
      clusters, originPng: pngs, targetPng: pngs, diffPng: diff,
      artifactsDir: dir,
    });
    expect(proposals[0]!.kind).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/analysis/fix-proposals.test.ts
```

- [ ] **Step 3: Write `packages/core/src/analysis/fix-proposals.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import type {
  Cluster, DomElement, DomSnapshot, FixProposal, Bbox,
  StyleMismatchProposal, MissingBlockProposal, UnknownProposal,
} from '../types.js';
import { elementAtPoint, type Point } from './element-at-point.js';
import { compareStyles } from './style-compare.js';

export interface GenerateFixProposalsInput {
  viewport: string;
  originSnapshot: DomSnapshot;
  targetSnapshot: DomSnapshot;
  clusters: Cluster[];
  originPng: Buffer;
  targetPng: Buffer;
  diffPng: Buffer;
  artifactsDir: string;
}

export async function generateFixProposals(input: GenerateFixProposalsInput): Promise<FixProposal[]> {
  const cropsDir = join(input.artifactsDir, 'crops');
  mkdirSync(cropsDir, { recursive: true });
  const originImg = PNG.sync.read(input.originPng);
  const targetImg = PNG.sync.read(input.targetPng);
  const diffImg = PNG.sync.read(input.diffPng);
  const proposals: FixProposal[] = [];

  for (const cluster of input.clusters) {
    const points = samplePoints(cluster.bbox, diffImg);
    const originEl = majorityElement(input.originSnapshot, points);
    const targetEl = majorityElement(input.targetSnapshot, points);

    const originCropPath = join(cropsDir, `${cluster.id}-origin.png`);
    const targetCropPath = join(cropsDir, `${cluster.id}-target.png`);
    writeFileSync(originCropPath, cropPng(originImg, cluster.bbox));
    writeFileSync(targetCropPath, cropPng(targetImg, cluster.bbox));

    const base = {
      clusterId: cluster.id,
      viewport: input.viewport,
      bbox: cluster.bbox,
      originCropPath,
      targetCropPath,
    };

    const classification = classify(originEl, targetEl, viewportArea(input.originSnapshot));
    if (classification === 'unknown') {
      const p: UnknownProposal = {
        ...base, kind: 'unknown',
        warning: 'No element found at cluster on either side',
        suggestedSearchTerms: [],
      };
      proposals.push(p);
      continue;
    }
    if (classification === 'missing_origin' || classification === 'missing_target') {
      const side = classification === 'missing_origin' ? 'target_only' : 'origin_only';
      const presentEl = classification === 'missing_origin' ? targetEl : originEl;
      const p: MissingBlockProposal = {
        ...base, kind: 'missing_block', side,
        missingElementSummary: presentEl ? summarizeElement(presentEl) : '<unknown>',
        suggestedSearchTerms: presentEl ? extractSearchTerms(presentEl) : [],
      };
      proposals.push(p);
      continue;
    }
    // style_mismatch
    const diffs = originEl && targetEl ? compareStyles(originEl, targetEl) : [];
    const p: StyleMismatchProposal = {
      ...base, kind: 'style_mismatch',
      styleDiffs: diffs,
      suggestedSearchTerms: originEl ? extractSearchTerms(originEl) : [],
      ...(originEl && originEl.text ? { originTextSample: originEl.text.slice(0, 80) } : {}),
    };
    proposals.push(p);
  }

  writeFileSync(join(input.artifactsDir, 'fix-proposals.json'), JSON.stringify(proposals, null, 2));
  return proposals;
}

function samplePoints(bbox: Bbox, diffImg: PNG): Point[] {
  const centroid = redCentroid(diffImg, bbox) ?? { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
  const center = { x: bbox.x + Math.floor(bbox.width / 2), y: bbox.y + Math.floor(bbox.height / 2) };
  const corners = [
    { x: bbox.x, y: bbox.y },
    { x: bbox.x + bbox.width - 1, y: bbox.y },
    { x: bbox.x, y: bbox.y + bbox.height - 1 },
    { x: bbox.x + bbox.width - 1, y: bbox.y + bbox.height - 1 },
  ];
  return [centroid, center, ...corners];
}

function redCentroid(img: PNG, bbox: Bbox): Point | undefined {
  let sumX = 0, sumY = 0, count = 0;
  const right = Math.min(img.width, bbox.x + bbox.width);
  const bottom = Math.min(img.height, bbox.y + bbox.height);
  for (let y = Math.max(0, bbox.y); y < bottom; y++) {
    for (let x = Math.max(0, bbox.x); x < right; x++) {
      const i = (img.width * y + x) * 4;
      if ((img.data[i]! > 0 || img.data[i+1]! > 0 || img.data[i+2]! > 0) && img.data[i+3]! > 0) {
        sumX += x; sumY += y; count++;
      }
    }
  }
  if (count === 0) return undefined;
  return { x: Math.floor(sumX / count), y: Math.floor(sumY / count) };
}

function majorityElement(snapshot: DomSnapshot, points: Point[]): DomElement | undefined {
  const counts = new Map<number, number>();
  let centroidIndex: number | undefined;
  for (let i = 0; i < points.length; i++) {
    const idx = elementAtPoint(snapshot, points[i]!);
    if (idx === undefined) continue;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
    if (i === 0) centroidIndex = idx;
  }
  if (counts.size === 0) return undefined;
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const topCount = sorted[0]![1];
  const tied = sorted.filter(([, c]) => c === topCount).map(([i]) => i);
  let chosen = tied[0]!;
  if (tied.length > 1) {
    // Tiebreak: centroid point, else smallest bbox area
    if (centroidIndex !== undefined && tied.includes(centroidIndex)) {
      chosen = centroidIndex;
    } else {
      chosen = tied.reduce((best, i) => {
        const a = snapshot.elements[i]!.bbox;
        const b = snapshot.elements[best]!.bbox;
        return (a.width * a.height) < (b.width * b.height) ? i : best;
      }, tied[0]!);
    }
  }
  return snapshot.elements[chosen];
}

type Classification = 'style_mismatch' | 'missing_origin' | 'missing_target' | 'unknown';

function classify(origin: DomElement | undefined, target: DomElement | undefined, viewportArea: number): Classification {
  if (!origin && !target) return 'unknown';
  const isOversized = (el: DomElement | undefined): boolean =>
    !!el && (el.bbox.width * el.bbox.height) > viewportArea * 0.5;
  const isRoot = (el: DomElement | undefined): boolean =>
    !!el && (el.tag === 'html' || el.tag === 'body');

  const originFake = !origin || (isRoot(origin) && !isRoot(target!)) || (isOversized(origin) && !isOversized(target));
  const targetFake = !target || (isRoot(target) && !isRoot(origin!)) || (isOversized(target) && !isOversized(origin));

  if (originFake && !targetFake) return 'missing_origin';
  if (targetFake && !originFake) return 'missing_target';
  return 'style_mismatch';
}

function viewportArea(snapshot: DomSnapshot): number {
  const root = snapshot.elements.find((e) => e.parentIndex === -1 && (e.tag === 'html' || e.tag === 'body'));
  if (root) return root.bbox.width * root.bbox.height;
  return 1920 * 1080;
}

function summarizeElement(el: DomElement): string {
  const tag = el.tag;
  const cls = el.attrs.class ? el.attrs.class.split(/\s+/)[0] : undefined;
  const id = el.attrs.id;
  const sel = [tag, id && `#${id}`, cls && `.${cls}`].filter(Boolean).join('');
  const text = el.text ? ` with text "${el.text.slice(0, 40)}"` : '';
  return `${sel}${text}`;
}

function extractSearchTerms(el: DomElement): string[] {
  const out: string[] = [];
  const text = el.text.trim().slice(0, 80);
  if (text) out.push(text);
  if (el.tag) out.push(el.tag);
  for (const key of ['aria-label', 'role', 'alt', 'title']) {
    const v = el.attrs[key];
    if (v) out.push(v);
  }
  return Array.from(new Set(out));
}

function cropPng(src: PNG, bbox: Bbox): Buffer {
  const x = Math.max(0, Math.floor(bbox.x));
  const y = Math.max(0, Math.floor(bbox.y));
  const w = Math.min(src.width - x, Math.ceil(bbox.width));
  const h = Math.min(src.height - y, Math.ceil(bbox.height));
  const out = new PNG({ width: Math.max(1, w), height: Math.max(1, h) });
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      const si = (src.width * (y + yy) + (x + xx)) * 4;
      const di = (out.width * yy + xx) * 4;
      out.data[di] = src.data[si]!;
      out.data[di+1] = src.data[si+1]!;
      out.data[di+2] = src.data[si+2]!;
      out.data[di+3] = src.data[si+3]!;
    }
  }
  return PNG.sync.write(out);
}
```

- [ ] **Step 4: Run — expect PASS (3/3)**

```bash
npx vitest run packages/core/src/analysis/fix-proposals.test.ts
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/analysis/fix-proposals.ts packages/core/src/analysis/fix-proposals.test.ts
git commit -m "feat(core): FixProposalGenerator (pure orchestrator)"
```

---

## Task 7: Update core index exports

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `packages/core/src/index-phase2.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extractClusters, elementAtPoint, compareStyles,
  generateFixProposals, captureDomSnapshot, STYLE_WHITELIST,
} from './index.js';

describe('phase 2 public API', () => {
  it('exports analysis + capture functions', () => {
    expect(typeof extractClusters).toBe('function');
    expect(typeof elementAtPoint).toBe('function');
    expect(typeof compareStyles).toBe('function');
    expect(typeof generateFixProposals).toBe('function');
    expect(typeof captureDomSnapshot).toBe('function');
    expect(Array.isArray(STYLE_WHITELIST)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/index-phase2.test.ts
```

- [ ] **Step 3: Append to `packages/core/src/index.ts`**

```ts
export { extractClusters } from './diff/clusters.js';
export type { ExtractClustersOptions } from './diff/clusters.js';
export { elementAtPoint } from './analysis/element-at-point.js';
export type { Point } from './analysis/element-at-point.js';
export { compareStyles, STYLE_WHITELIST } from './analysis/style-compare.js';
export { generateFixProposals } from './analysis/fix-proposals.js';
export type { GenerateFixProposalsInput } from './analysis/fix-proposals.js';
export { captureDomSnapshot } from './capture/dom-snapshot.js';
export type { CaptureDomSnapshotOptions } from './capture/dom-snapshot.js';
```

- [ ] **Step 4: Run — expect PASS, typecheck clean**

```bash
npx vitest run
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/index.ts packages/core/src/index-phase2.test.ts
git commit -m "feat(core): export phase 2 public API"
```

---

## Task 8: Integrate DomSnapshotter into PageCapturer

**Files:**
- Modify: `packages/core/src/capture/capturer.ts`
- Modify: `packages/core/src/capture/capturer.test.ts` (add assertion)

- [ ] **Step 1: Add new test case to `capturer.test.ts`**

Append this inside the existing `describe('PageCapturer', ...)`:

```ts
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
```

Also add `readFileSync` to the imports at the top of the test file:
```ts
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
```

- [ ] **Step 2: Run — expect FAIL (dom.json doesn't exist yet)**

```bash
npx vitest run packages/core/src/capture/capturer.test.ts
```

- [ ] **Step 3: Modify `packages/core/src/capture/capturer.ts`**

Add import at top:
```ts
import { captureDomSnapshot } from './dom-snapshot.js';
```

In `captureSite` method, after `writeFileSync(opts.output, png)` and before `return undefined`, insert:

```ts
// Capture DOM snapshot alongside screenshot (side = 'origin' | 'target' inferred from filename)
const side = opts.output.endsWith('origin.png') ? 'origin' : 'target';
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
void side;  // reserved for future per-side logic
```

Nothing else changes.

- [ ] **Step 4: Run — expect PASS (new test + all existing green)**

```bash
npx vitest run packages/core/src/capture/capturer.test.ts
npx vitest run   # full suite, all should pass
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/capture/capturer.ts packages/core/src/capture/capturer.test.ts
git commit -m "feat(core): write dom.json alongside screenshot in PageCapturer"
```

---

## Task 9: Integrate cluster + proposal generation into MigrationEngine

**Files:**
- Modify: `packages/core/src/engine/migration.ts`
- Modify: `packages/core/src/engine/migration.test.ts`

- [ ] **Step 1: Add assertion to existing migration test**

In the existing `'init → next → diff → mark, then resume'` test, after `const report = await e.diffCurrent();`, add:

```ts
// Phase 2 artifacts must exist
const slug = report.pagePath === '/' ? 'root' : report.pagePath.replace(/^\//, '').replace(/\//g, '__');
const vpDir = join(work, 'artifacts', slug, 'desktop');
expect(existsSync(join(vpDir, 'origin.dom.json'))).toBe(true);
expect(existsSync(join(vpDir, 'target.dom.json'))).toBe(true);
expect(existsSync(join(work, 'artifacts', slug, 'clusters.json'))).toBe(true);
expect(existsSync(join(work, 'artifacts', slug, 'fix-proposals.json'))).toBe(true);
```

Add `existsSync` to imports if missing:
```ts
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
```

- [ ] **Step 2: Run — expect FAIL (clusters.json and fix-proposals.json not written)**

```bash
npx vitest run packages/core/src/engine/migration.test.ts
```

- [ ] **Step 3: Modify `packages/core/src/engine/migration.ts`**

Add imports:
```ts
import { readFileSync } from 'node:fs';
import { extractClusters } from '../diff/clusters.js';
import { generateFixProposals } from '../analysis/fix-proposals.js';
import type { DomSnapshot, Cluster, FixProposal } from '../types.js';
```

In `diffPath`, after the existing `writeFileSync(join(artifactsDir, 'report.json'), ...)` line, insert (still inside the try block):

```ts
// Phase 2: cluster extraction + fix proposals, per viewport, merged across viewports
const allClusters: Cluster[] = [];
const allProposals: FixProposal[] = [];
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
    // Log-only: analysis failure doesn't block the whole diff flow
    // Proposals for this viewport will simply be missing.
    void analysisErr;
  }
}
writeFileSync(join(artifactsDir, 'clusters.json'), JSON.stringify(allClusters, null, 2));
writeFileSync(join(artifactsDir, 'fix-proposals.json'), JSON.stringify(allProposals, null, 2));
```

The existing return statement stays the same.

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run packages/core/src/engine/migration.test.ts
npx vitest run
```

- [ ] **Step 5: Typecheck clean, commit**

```bash
npm run typecheck
git add packages/core/src/engine/migration.ts packages/core/src/engine/migration.test.ts
git commit -m "feat(core): write clusters.json + fix-proposals.json in diffPath"
```

---

## Task 10: MCP tool `get_fix_proposals`

**Files:**
- Create: `packages/mcp-server/src/tools/fix-proposals.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Modify: `packages/mcp-server/src/index.ts`
- Modify: `packages/mcp-server/src/server.test.ts`
- Modify: `packages/core/src/engine/migration.ts` (add `proposalsPath()` helper)

- [ ] **Step 1: Add failing test to `packages/mcp-server/src/server.test.ts`**

Inside the existing `describe('MCP tools', ...)`:

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/mcp-server/src/server.test.ts
```

- [ ] **Step 3: Add helper to `MigrationEngine` in `packages/core/src/engine/migration.ts`**

Inside the class, add:

```ts
proposalsPath(): string {
  const current = this.currentPath();
  if (!current) throw new Error('No page in progress. Call nextPage() first.');
  return join(this.opts.artifactsDir, slug(current), 'fix-proposals.json');
}
```

(Ensures the engine owns knowledge of the artifact layout.)

- [ ] **Step 4: Write `packages/mcp-server/src/tools/fix-proposals.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import type { MigrationEngine, FixProposal } from '@noders/page-to-page-core';

export function handleGetFixProposals(engine: MigrationEngine): FixProposal[] {
  const path = engine.proposalsPath();
  if (!existsSync(path)) {
    throw new Error(`No fix proposals for current page. Call diff_current() first. (expected ${path})`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`fix-proposals.json corrupt at ${path}. Re-run diff_current to regenerate. ${(err as Error).message}`);
  }
}
```

- [ ] **Step 5: Wire into `packages/mcp-server/src/server.ts`**

Add import:
```ts
import { handleGetFixProposals } from './tools/fix-proposals.js';
```

Add to switch:
```ts
case 'get_fix_proposals': return handleGetFixProposals(await ensureEngine());
```

- [ ] **Step 6: Register in `packages/mcp-server/src/index.ts` TOOLS array**

Add entry:
```ts
{ name: 'get_fix_proposals', description: 'Return structured FixProposal[] for current page (requires prior diff_current).', inputSchema: { type: 'object', properties: {} } },
```

- [ ] **Step 7: Run tests, typecheck**

```bash
npm run build
npx vitest run
npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/engine/migration.ts packages/mcp-server/
git commit -m "feat(mcp): get_fix_proposals tool reads fix-proposals.json for current page"
```

---

## Task 11: Extend fixtures + E2E assertions

**Files:**
- Modify: `test-fixtures/pages.ts`
- Modify: `packages/mcp-server/src/e2e.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Modify `test-fixtures/pages.ts`** — the existing `/` and `/about` fixtures already trigger style_mismatch (font-size) and missing_block (team block). Leave them unchanged. Just double-check the content by re-reading the file; no edit needed unless there is drift.

- [ ] **Step 2: Extend E2E test in `packages/mcp-server/src/e2e.test.ts`**

After the existing final `expect(existsSync(join(work, 'artifacts'))).toBe(true);` line, add:

```ts
    // Verify fix proposals were generated for non-identical pages
    const proposalsFiles: string[] = [];
    for (const slug of ['root', 'about']) {
      const p = join(work, 'artifacts', slug, 'fix-proposals.json');
      if (existsSync(p)) proposalsFiles.push(p);
    }
    expect(proposalsFiles.length).toBeGreaterThanOrEqual(1);
    for (const f of proposalsFiles) {
      const arr = JSON.parse(readFileSync(f, 'utf-8'));
      expect(Array.isArray(arr)).toBe(true);
      for (const p of arr) {
        expect(['style_mismatch', 'missing_block', 'unknown']).toContain(p.kind);
      }
    }
```

Add `readFileSync` to imports at top if missing:
```ts
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
```

- [ ] **Step 3: Run full E2E — expect PASS**

```bash
npm run build
npx vitest run packages/mcp-server/src/e2e.test.ts
```

- [ ] **Step 4: Update `README.md`**

Modify the "Claude Code tools" section to insert `get_fix_proposals` between `verify_current` and `mark_matched`:

```markdown
- `get_fix_proposals()` — return structured `FixProposal[]` for current page (requires prior `diff_current()`)
```

And update "Phase scope" section:

```markdown
- **Phase 1 (shipped):** pixel-diff, full MCP surface, state, discovery, bootstrap
- **Phase 2 (shipped):** pixel-first DOM analysis — cluster extraction, `FixProposal[]` with `kind: 'style_mismatch' | 'missing_block' | 'unknown'`, offline elementAtPoint, style diff over whitelist
- **Phase 3 (future):** auth flow (autologin + headful fallback), real-site smoke, iframe support, design-token awareness
```

- [ ] **Step 5: Full suite + typecheck, commit**

```bash
npx vitest run
npm run typecheck
git add packages/mcp-server/src/e2e.test.ts README.md
git commit -m "test: E2E asserts fix-proposals.json presence; README documents phase 2"
```

---

## Task 12: Push

- [ ] **Step 1: Confirm all local commits, push**

```bash
git log --oneline origin/main..HEAD
git push
```

Expected: all Phase 2 commits pushed to `https://github.com/NODERSSeptimA/page_to_page.git` main.

---

## Self-review (post-plan)

**1. Spec coverage:**
- §3 Decisions #1 pixel-first → Task 6 (FixProposalGenerator uses coordinate lookup) ✅
- §3 #2 flood-fill + merge → Task 2 ✅
- §3 #3 6-point majority vote → Task 6 (`samplePoints` + `majorityElement`) ✅
- §3 #4 wide whitelist, diff-only → Task 4 (`STYLE_WHITELIST`), Task 6 (only diffs in output) ✅
- §3 #5 unified FixProposal[] with kind → Task 1 types, Task 6 classify ✅
- §3 #6 `get_fix_proposals` tool, `diff_current` unchanged summary → Task 10 ✅
- §3 #7 disk paths for crops → Task 6 writes to `crops/` ✅
- §3 #8 snapshot-first (DOM JSON) → Task 5, Task 8 ✅
- §3 #9 search terms text + tag + semantic + alt/title → Task 6 `extractSearchTerms` ✅
- §5.1 DomSnapshotter soft cap 15k → Task 5 ✅
- §5.2 ClusterExtractor → Task 2 ✅
- §5.3 ElementAtPoint → Task 3 ✅
- §5.4 StyleComparator whitelist + normalization → Task 4 ✅
- §5.5 FixProposalGenerator orchestrator → Task 6 ✅
- §6 data flow → Tasks 8, 9, 10 wire it together ✅
- §7 error handling: empty/truncated snapshot → Task 5 writes error field; cluster failures → Task 9 analysis errors swallowed per-viewport ✅
- §9 in-scope items all mapped to tasks ✅

**2. Placeholder scan:** No TBD/TODO in plan. All code blocks complete.

**3. Type consistency:** `FixProposal`, `Cluster`, `DomSnapshot`, `DomElement`, `StyleDiff`, `Bbox` defined in Task 1; used in Tasks 2–6 with consistent shapes. Method names `extractClusters`, `elementAtPoint`, `compareStyles`, `generateFixProposals`, `captureDomSnapshot` consistent across all tasks and final index exports in Task 7.

One intentional simplification vs spec §4 artifact layout: I write a single `fix-proposals.json` and `clusters.json` at the page slug level (aggregated across all viewports), not per-viewport. The spec's diagram shows them per-viewport, but aggregating simplifies `get_fix_proposals` (one file to read) without losing information (each FixProposal carries `viewport` as a field). Individual viewports still have their own `crops/` because crop images are viewport-specific.

