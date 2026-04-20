import express from 'express';
import { PAGES } from '../pages.js';

export function createTargetApp(): express.Express {
  const app = express();
  for (const p of PAGES) app.get(p.path, (_req, res) => res.type('html').send(p.targetHtml));
  return app;
}
