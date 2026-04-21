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
