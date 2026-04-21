import { PNG } from 'pngjs';
import type { Cluster, Bbox } from '../types.js';

export interface ExtractClustersOptions {
  mergeDistance?: number;   // default 30
  minClusterArea?: number;  // default 64
}

export function extractClusters(diffPngBuffer: Buffer, opts: ExtractClustersOptions = {}): Cluster[] {
  const mergeDistance = opts.mergeDistance ?? 30;
  const minClusterArea = opts.minClusterArea ?? 64;
  const png = PNG.sync.read(diffPngBuffer);
  const { width, height, data } = png;
  const seen = new Uint8Array(width * height);

  const isRed = (x: number, y: number): boolean => {
    const i = (width * y + x) * 4;
    return (data[i]! > 0 || data[i + 1]! > 0 || data[i + 2]! > 0) && data[i + 3]! > 0;
  };

  const rawBoxes: Array<{ bbox: Bbox; pixelCount: number }> = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = width * y + x;
      if (seen[idx] || !isRed(x, y)) continue;
      // BFS flood fill
      const queue: Array<[number, number]> = [[x, y]];
      let minX = x, minY = y, maxX = x, maxY = y, count = 0;
      while (queue.length > 0) {
        const [cx, cy] = queue.shift()!;
        const ci = width * cy + cx;
        if (seen[ci]) continue;
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        if (!isRed(cx, cy)) continue;
        seen[ci] = 1; count++;
        if (cx < minX) minX = cx; if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy; if (cy > maxY) maxY = cy;
        queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
      }
      rawBoxes.push({
        bbox: { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 },
        pixelCount: count,
      });
    }
  }

  // Merge close boxes
  const merged = mergeBoxes(rawBoxes, mergeDistance);
  // Filter by minClusterArea (pixel count)
  const filtered = merged.filter((m) => m.pixelCount >= minClusterArea);
  return filtered.map((m, i) => ({ id: `c-${i + 1}`, bbox: m.bbox, pixelCount: m.pixelCount }));
}

function mergeBoxes(
  boxes: Array<{ bbox: Bbox; pixelCount: number }>,
  maxDistance: number,
): Array<{ bbox: Bbox; pixelCount: number }> {
  const remaining = [...boxes];
  const result: Array<{ bbox: Bbox; pixelCount: number }> = [];
  while (remaining.length > 0) {
    let current = remaining.shift()!;
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < remaining.length; i++) {
        if (bboxDistance(current.bbox, remaining[i]!.bbox) <= maxDistance) {
          current = {
            bbox: unionBbox(current.bbox, remaining[i]!.bbox),
            pixelCount: current.pixelCount + remaining[i]!.pixelCount,
          };
          remaining.splice(i, 1);
          i--;
          changed = true;
        }
      }
    }
    result.push(current);
  }
  return result;
}

function bboxDistance(a: Bbox, b: Bbox): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return dx + dy;
}

function unionBbox(a: Bbox, b: Bbox): Bbox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}
