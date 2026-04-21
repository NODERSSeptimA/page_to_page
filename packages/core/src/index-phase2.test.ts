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
