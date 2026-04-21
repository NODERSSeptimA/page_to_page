import { describe, it, expect } from 'vitest';
import { buildMaskCss } from './mask.js';

describe('buildMaskCss', () => {
  it('empty returns empty string', () => {
    expect(buildMaskCss([]).trim()).toBe('');
  });

  it('emits a host rule and a child rule for each selector', () => {
    const css = buildMaskCss(['.carousel', '[data-mask]']);
    expect(css).toContain('.carousel {');
    expect(css).toContain('[data-mask] {');
    expect(css).toContain('.carousel > *');
    expect(css).toContain('[data-mask] > *');
  });

  it('uses !important so page styles cannot override the mask', () => {
    const css = buildMaskCss(['.x']);
    expect(css).toContain('background: #cccccc !important');
    expect(css).toContain('visibility: hidden !important');
  });

  it('emits one rule block per selector so a malformed selector only drops its own block', () => {
    // Two rules per selector (host + child): 2 * 2 = 4 opening braces for 2 selectors.
    const css = buildMaskCss(['.a', '.b']);
    const openBraces = css.match(/\{/g)?.length ?? 0;
    expect(openBraces).toBe(4);
  });
});
