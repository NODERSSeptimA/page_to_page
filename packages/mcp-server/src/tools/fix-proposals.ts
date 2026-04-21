import { existsSync, readFileSync } from 'node:fs';
import type { MigrationEngine, FixProposal } from '@noders/page-to-page-core';
import { z } from 'zod';

export const GetFixProposalsInput = z.object({ pagePath: z.string().optional() });

export function handleGetFixProposals(
  engine: MigrationEngine,
  input: z.infer<typeof GetFixProposalsInput>,
): FixProposal[] {
  const path = engine.proposalsPath(input.pagePath);
  if (!existsSync(path)) {
    throw new Error(`No fix proposals at ${path}. Call diff_current() first, or verify pagePath matches a completed page.`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`fix-proposals.json corrupt at ${path}. Re-run diff_current to regenerate. ${(err as Error).message}`);
  }
}
