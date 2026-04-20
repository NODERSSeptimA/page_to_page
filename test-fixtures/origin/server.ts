import express from 'express';
import { PAGES, sitemapXml } from '../pages.js';

export function createOriginApp(): express.Express {
  const app = express();
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(sitemapXml(`http://${req.headers.host}`));
  });
  for (const p of PAGES) app.get(p.path, (_req, res) => res.type('html').send(p.originHtml));
  return app;
}
