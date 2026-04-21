export interface FixturePage {
  path: string;
  originHtml: string;
  targetHtml: string;
  expectDiff: boolean;
}

const base = (body: string, css: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>fx</title>` +
  `<style>body{margin:0;font-family:sans-serif;background:#fff}${css}</style></head>` +
  `<body>${body}</body></html>`;

export const PAGES: FixturePage[] = [
  {
    path: '/',
    originHtml: base('<h1 class="hero">Welcome</h1><p>Original</p>', '.hero{font-size:56px;color:#111;padding:40px}'),
    targetHtml: base('<h1 class="hero">Welcome</h1><p>Original</p>', '.hero{font-size:48px;color:#111;padding:40px}'),
    expectDiff: true,
  },
  {
    path: '/about',
    originHtml: base('<h1>About</h1><div class="team"><h2>Team</h2></div>', 'h1{font-size:40px}.team{padding:20px;background:#eef}'),
    targetHtml: base('<h1>About</h1>', 'h1{font-size:40px}'),
    expectDiff: true,
  },
  {
    path: '/identical',
    originHtml: base('<h1>Same</h1>', 'h1{font-size:32px}'),
    targetHtml: base('<h1>Same</h1>', 'h1{font-size:32px}'),
    expectDiff: false,
  },
  {
    // Page that simulates Angular-style change detection: 400ms after
    // load, the children of [id="rerender-root"] are swapped out via
    // replaceChildren(). Any inline styles that would have been set on
    // the host or its descendants are effectively wiped for the new
    // subtree. Used to verify CSS-injection masking survives re-render.
    path: '/rerender',
    originHtml: base(
      '<div id="rerender-root"><h1>Original</h1><p>Before re-render</p></div>' +
      '<script>setTimeout(() => { ' +
      '  const root = document.getElementById("rerender-root");' +
      '  const h = document.createElement("h1"); h.textContent = "Swapped"; ' +
      '  const p = document.createElement("p"); p.textContent = "After re-render"; ' +
      '  root.replaceChildren(h, p); ' +
      '}, 400);</script>',
      '#rerender-root{padding:20px;background:#ffccaa;color:#333}',
    ),
    targetHtml: base(
      '<div id="rerender-root"><h1>Original</h1><p>Before re-render</p></div>' +
      '<script>setTimeout(() => { ' +
      '  const root = document.getElementById("rerender-root");' +
      '  const h = document.createElement("h1"); h.textContent = "Swapped"; ' +
      '  const p = document.createElement("p"); p.textContent = "After re-render"; ' +
      '  root.replaceChildren(h, p); ' +
      '}, 400);</script>',
      '#rerender-root{padding:20px;background:#ffccaa;color:#333}',
    ),
    expectDiff: false,
  },
  {
    // Page whose content arrives via setTimeout (simulates data-driven SPA).
    // Used to exercise captureWaitForSelector: without it, a fast capture
    // sees "Loading..."; with it, capture waits until #ready appears.
    path: '/delayed',
    originHtml: base(
      '<h1 id="content">Loading...</h1>' +
      '<script>setTimeout(() => { const h = document.getElementById("content"); h.textContent = "Ready"; h.id = "ready"; }, 1500);</script>',
      'h1{font-size:32px}',
    ),
    targetHtml: base(
      '<h1 id="content">Loading...</h1>' +
      '<script>setTimeout(() => { const h = document.getElementById("content"); h.textContent = "Ready"; h.id = "ready"; }, 1500);</script>',
      'h1{font-size:32px}',
    ),
    expectDiff: false,
  },
];

export function sitemapXml(origin: string): string {
  const urls = PAGES.map((p) => `  <url><loc>${origin}${p.path}</loc></url>`).join('\n');
  return `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
