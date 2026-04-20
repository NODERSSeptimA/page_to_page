import { describe, it, expect } from 'vitest';
import { STABILIZE_INIT_SCRIPT, stabilizeStyleTag } from './stabilize.js';
import { resolveViewports } from './viewport.js';
import { DEFAULT_VIEWPORTS } from '../types.js';

describe('stabilization', () => {
  it('init script overrides Date and Math.random', () => {
    expect(STABILIZE_INIT_SCRIPT).toMatch(/Math\.random/);
    expect(STABILIZE_INIT_SCRIPT).toMatch(/Date/);
  });
  it('style tag disables animations and transitions', () => {
    expect(stabilizeStyleTag()).toMatch(/animation:\s*none/);
    expect(stabilizeStyleTag()).toMatch(/transition:\s*none/);
  });
});

describe('viewports', () => {
  it('defaults when unset', () => { expect(resolveViewports(undefined)).toEqual(DEFAULT_VIEWPORTS); });
  it('custom list passed through', () => {
    const c = [{ name: 'wide', width: 1920, height: 1080 }];
    expect(resolveViewports(c)).toEqual(c);
  });
});
