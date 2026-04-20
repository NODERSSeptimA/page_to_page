import { describe, it, expect } from 'vitest';
import { buildMaskScript } from './mask.js';

describe('buildMaskScript', () => {
  it('empty returns empty string', () => {
    expect(buildMaskScript([]).trim()).toBe('');
  });
  it('includes all selectors', () => {
    const s = buildMaskScript(['.carousel', '[data-mask]']);
    expect(s).toContain('.carousel');
    expect(s).toContain('[data-mask]');
    expect(s).toContain('background');
  });
  it('uses JSON.stringify to escape selectors (no backtick injection)', () => {
    const s = buildMaskScript(['evil`injected`']);
    expect(s).toContain('"evil`injected`"');
  });
});
