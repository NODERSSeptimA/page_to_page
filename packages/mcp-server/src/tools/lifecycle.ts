import type { MigrationEngine } from '@noders/page-to-page-core';
import { z } from 'zod';

export const SkipInput = z.object({ reason: z.string().min(1) });
export const HasIssuesInput = z.object({ note: z.string().optional() });

export function handleMarkMatched(engine: MigrationEngine): { pagesRemaining: number } {
  engine.markMatched();
  return { pagesRemaining: engine.status().pending };
}

export function handleMarkHasIssues(engine: MigrationEngine, input: z.infer<typeof HasIssuesInput>): { pagesRemaining: number } {
  engine.markHasIssues(input.note);
  return { pagesRemaining: engine.status().pending };
}

export function handleSkipCurrent(engine: MigrationEngine, input: z.infer<typeof SkipInput>): { pagesRemaining: number } {
  engine.skipCurrent(input.reason);
  return { pagesRemaining: engine.status().pending };
}
