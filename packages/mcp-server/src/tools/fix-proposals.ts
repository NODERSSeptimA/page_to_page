import { existsSync, readFileSync } from 'node:fs';
import type { MigrationEngine, FixProposal } from '@noders/page-to-page-core';

export function handleGetFixProposals(engine: MigrationEngine): FixProposal[] {
  const path = engine.proposalsPath();
  if (!existsSync(path)) {
    throw new Error(`No fix proposals for current page. Call diff_current() first. (expected ${path})`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`fix-proposals.json corrupt at ${path}. Re-run diff_current to regenerate. ${(err as Error).message}`);
  }
}
