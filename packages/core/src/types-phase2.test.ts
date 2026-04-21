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
