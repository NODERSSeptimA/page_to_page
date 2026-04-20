import { z } from 'zod';

export const FixHistoryEntrySchema = z.object({ at: z.string(), description: z.string() });

export const PageSchema = z.object({
  path: z.string(),
  status: z.enum(['pending','in_progress','matched','has_issues','skipped','error']),
  source: z.enum(['sitemap','crawl','manual']),
  authRequired: z.boolean().optional(),
  lastRunAt: z.string().optional(),
  issuesCount: z.number().optional(),
  skipReason: z.string().optional(),
  fixHistory: z.array(FixHistoryEntrySchema),
});

export const StateFileSchema = z.object({
  version: z.literal(1),
  startedAt: z.string(),
  originUrl: z.string().url(),
  targetUrl: z.string().url(),
  pages: z.array(PageSchema),
  current: z.string().optional(),
});

export type StateFile = z.infer<typeof StateFileSchema>;
export type StatePage = z.infer<typeof PageSchema>;
