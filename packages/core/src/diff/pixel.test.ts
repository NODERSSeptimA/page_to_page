import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { pixelDiff } from './pixel.js';

function solid(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (w * y + x) * 4;
    png.data[i] = rgba[0]; png.data[i+1] = rgba[1]; png.data[i+2] = rgba[2]; png.data[i+3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe('pixelDiff', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-px-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('identical images → 0 diff', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    const buf = solid(10, 10, [255, 255, 255, 255]);
    writeFileSync(a, buf); writeFileSync(b, buf);
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBe(0);
    expect(existsSync(d)).toBe(true);
  });

  it('fully different → near 100%', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    writeFileSync(a, solid(10, 10, [255, 255, 255, 255]));
    writeFileSync(b, solid(10, 10, [0, 0, 0, 255]));
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBeGreaterThan(0.9);
  });

  it('normalizes different sizes', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    writeFileSync(a, solid(10, 10, [255, 255, 255, 255]));
    writeFileSync(b, solid(20, 20, [255, 255, 255, 255]));
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBeGreaterThan(0);
  });
});
