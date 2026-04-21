import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
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
