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
    const a = elWith({ 'padding-top': '10px' });
    const b = elWith({});
    const r = compareStyles(a, b);
    expect(r.some((d) => d.property === 'padding-top' && d.origin === '10px' && d.target === '')).toBe(true);
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
