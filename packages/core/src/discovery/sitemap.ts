import { XMLParser } from 'fast-xml-parser';

export async function fetchSitemapPaths(originUrl: string): Promise<string[]> {
  const base = new URL(originUrl);
  const sitemapUrl = new URL('/sitemap.xml', base).toString();
  let res: Response;
  try { res = await fetch(sitemapUrl); } catch { return []; }
  if (!res.ok) return [];
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  let parsed: unknown;
  try { parsed = parser.parse(xml); } catch { return []; }
  const urlset = (parsed as Record<string, unknown>)?.urlset as
    | { url?: Array<{ loc?: string }> | { loc?: string } } | undefined;
  if (!urlset) return [];
  const entries = Array.isArray(urlset.url) ? urlset.url : urlset.url ? [urlset.url] : [];
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.loc) continue;
    try {
      const u = new URL(e.loc);
      if (u.host !== base.host) continue;
      out.add(u.pathname);
    } catch { /* ignore */ }
  }
  return Array.from(out);
}
