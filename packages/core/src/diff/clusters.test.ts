import { describe, it, expect } from 'vitest';
import { PNG } from 'pngjs';
import { extractClusters } from './clusters.js';

function makePng(width: number, height: number, redPixels: Array<[number, number]>): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(0);
  for (const [x, y] of redPixels) {
    const idx = (width * y + x) * 4;
    png.data[idx] = 255; png.data[idx+1] = 0; png.data[idx+2] = 0; png.data[idx+3] = 255;
  }
  return PNG.sync.write(png);
}

describe('extractClusters', () => {
  it('empty diff returns []', () => {
    const buf = makePng(20, 20, []);
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 })).toEqual([]);
  });

  it('single red pixel becomes one cluster (ignoring minArea)', () => {
    const buf = makePng(20, 20, [[5, 5]]);
    const clusters = extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.bbox).toEqual({ x: 5, y: 5, width: 1, height: 1 });
    expect(clusters[0]!.pixelCount).toBe(1);
  });

  it('single pixel filtered out by minClusterArea', () => {
    const buf = makePng(20, 20, [[5, 5]]);
    expect(extractClusters(buf, { minClusterArea: 2, mergeDistance: 0 })).toEqual([]);
  });

  it('contiguous pixels form one cluster', () => {
    const pts: Array<[number, number]> = [[2,2],[3,2],[2,3],[3,3]]; // 2x2 block
    const buf = makePng(20, 20, pts);
    const clusters = extractClusters(buf, { minClusterArea: 1, mergeDistance: 0 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.bbox).toEqual({ x: 2, y: 2, width: 2, height: 2 });
    expect(clusters[0]!.pixelCount).toBe(4);
  });

  it('two disjoint clusters far apart stay separate', () => {
    const buf = makePng(40, 40, [[2,2],[30,30]]);
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 5 })).toHaveLength(2);
  });

  it('two disjoint clusters merge when within mergeDistance', () => {
    const buf = makePng(40, 40, [[2,2],[10,2]]); // gap of 7 px in x
    expect(extractClusters(buf, { minClusterArea: 1, mergeDistance: 10 })).toHaveLength(1);
  });

  it('cluster ids are c-1, c-2, ...', () => {
    const buf = makePng(40, 40, [[2,2],[30,30]]);
    const cs = extractClusters(buf, { minClusterArea: 1, mergeDistance: 5 });
    const ids = cs.map((c) => c.id).sort();
    expect(ids).toEqual(['c-1', 'c-2']);
  });
});
