export interface CrawlOptions { maxDepth?: number; maxPages?: number }

export async function crawlPaths(originUrl: string, opts: CrawlOptions = {}): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 500;
  const base = new URL(originUrl);
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: '/', depth: 0 }];
  while (queue.length > 0 && visited.size < maxPages) {
    const node = queue.shift()!;
    if (visited.has(node.path)) continue;
    visited.add(node.path);
    if (node.depth >= maxDepth) continue;
    let html: string;
    try {
      const res = await fetch(new URL(node.path, base).toString());
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    for (const href of extractHrefs(html)) {
      try {
        const u = new URL(href, base);
        if (u.host !== base.host) continue;
        const p = u.pathname;
        if (!visited.has(p)) queue.push({ path: p, depth: node.depth + 1 });
      } catch { /* ignore */ }
    }
  }
  return Array.from(visited);
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (m[1]) out.push(m[1]);
  return out;
}
