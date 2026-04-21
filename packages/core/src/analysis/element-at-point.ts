import type { DomSnapshot } from '../types.js';

export interface Point { x: number; y: number }

export function elementAtPoint(snapshot: DomSnapshot, point: Point): number | undefined {
  const candidates: Array<{ index: number; depth: number; area: number }> = [];
  for (let i = 0; i < snapshot.elements.length; i++) {
    const e = snapshot.elements[i]!;
    const { x, y, width, height } = e.bbox;
    if (point.x < x || point.x >= x + width) continue;
    if (point.y < y || point.y >= y + height) continue;
    candidates.push({ index: i, depth: depthOf(snapshot, i), area: width * height });
  }
  if (candidates.length === 0) return undefined;
  candidates.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth; // deeper first
    return a.area - b.area;                             // smaller area first
  });
  return candidates[0]!.index;
}

function depthOf(snapshot: DomSnapshot, index: number): number {
  let depth = 0;
  let cur = index;
  while (cur !== -1 && depth < 10000) {
    const parent = snapshot.elements[cur]?.parentIndex ?? -1;
    if (parent === -1) break;
    cur = parent;
    depth++;
  }
  return depth;
}
