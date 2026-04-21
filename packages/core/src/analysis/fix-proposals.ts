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

    const classification = classify(originEl, targetEl, getViewportArea(input.originSnapshot));
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

function getViewportArea(snapshot: DomSnapshot): number {
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
