import type { MigrationEngine } from '@noders/page-to-page-core';
import { handleInit, InitInput } from './tools/init.js';
import { handleNextPage, handleStatus, handleResume, ResumeInput } from './tools/navigation.js';
import { handleDiffCurrent, handleVerifyCurrent } from './tools/diff.js';
import { handleMarkMatched, handleMarkHasIssues, handleSkipCurrent, SkipInput, HasIssuesInput } from './tools/lifecycle.js';
import { handleGetFixProposals, GetFixProposalsInput } from './tools/fix-proposals.js';

export interface TestServer {
  call(tool: string, args: unknown): Promise<any>;
  close(): Promise<void>;
}

export function createServer(): TestServer {
  let engine: MigrationEngine | undefined;
  async function ensureEngine(): Promise<MigrationEngine> {
    if (!engine) throw new Error('Migration not initialized. Call init_migration or resume first.');
    return engine;
  }
  return {
    async call(tool, args) {
      switch (tool) {
        case 'init_migration': {
          if (engine) { await engine.close(); engine = undefined; }
          const input = InitInput.parse(args);
          const r = await handleInit(input);
          engine = r.engine;
          return { discovered: r.discovered, auth: r.auth, estimatedSeconds: r.estimatedSeconds };
        }
        case 'resume': {
          if (engine) { await engine.close(); engine = undefined; }
          const input = ResumeInput.parse(args);
          const r = await handleResume(input);
          engine = r.engine;
          return { total: r.total, pending: r.pending, nextPath: r.nextPath };
        }
        case 'next_page':     return handleNextPage(await ensureEngine());
        case 'diff_current':  return handleDiffCurrent(await ensureEngine());
        case 'verify_current':return handleVerifyCurrent(await ensureEngine());
        case 'mark_matched':   return handleMarkMatched(await ensureEngine());
        case 'mark_has_issues': return handleMarkHasIssues(await ensureEngine(), HasIssuesInput.parse(args));
        case 'skip_current':   return handleSkipCurrent(await ensureEngine(), SkipInput.parse(args));
        case 'status':        return handleStatus(await ensureEngine());
        case 'get_fix_proposals': return handleGetFixProposals(await ensureEngine(), GetFixProposalsInput.parse(args));
        default: throw new Error(`Unknown tool: ${tool}`);
      }
    },
    async close() { if (engine) { await engine.close(); engine = undefined; } },
  };
}
