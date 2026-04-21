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
