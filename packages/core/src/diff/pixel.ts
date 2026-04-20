import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface PixelDiffResult {
  diffPercent: number;
  width: number;
  height: number;
}

export async function pixelDiff(originPath: string, targetPath: string, diffPath: string): Promise<PixelDiffResult> {
  const origin = PNG.sync.read(readFileSync(originPath));
  const target = PNG.sync.read(readFileSync(targetPath));
  const width = Math.max(origin.width, target.width);
  const height = Math.max(origin.height, target.height);
  const a = normalize(origin, width, height);
  const b = normalize(target, width, height);
  const diff = new PNG({ width, height });
  const mismatch = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, includeAA: false });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { diffPercent: mismatch / (width * height), width, height };
}

function normalize(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  // Fill with opaque black so padded region differs visibly from white content;
  // transparent fill (alpha=0) blends to white in pixelmatch and masks differences.
  for (let i = 0; i < w * h * 4; i += 4) {
    out.data[i] = 0; out.data[i+1] = 0; out.data[i+2] = 0; out.data[i+3] = 255;
  }
  const cw = Math.min(w, src.width);
  const ch = Math.min(h, src.height);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = (src.width * y + x) * 4;
    const di = (w * y + x) * 4;
    out.data[di] = src.data[si]!;
    out.data[di+1] = src.data[si+1]!;
    out.data[di+2] = src.data[si+2]!;
    out.data[di+3] = src.data[si+3]!;
  }
  return out;
}
