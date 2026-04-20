import type { MigrationEngine } from '@noders/page-to-page-core';
import { loadConfig, MigrationEngine as Engine } from '@noders/page-to-page-core';
import { z } from 'zod';

export const ResumeInput = z.object({ configPath: z.string() });

export function handleNextPage(engine: MigrationEngine): { path: string; viewports: string[] } | { done: true } {
  const n = engine.nextPage();
  if (!n) return { done: true };
  return { path: n.path, viewports: [] };
}

export function handleStatus(engine: MigrationEngine): ReturnType<MigrationEngine['status']> {
  return engine.status();
}

export async function handleResume(
  input: z.infer<typeof ResumeInput>,
): Promise<{ engine: MigrationEngine; total: number; pending: number; nextPath?: string }> {
  const cfg = loadConfig(input.configPath);
  const engine = await Engine.resume({
    stateFile: cfg.stateFile, artifactsDir: cfg.artifactsDir,
    viewports: cfg.viewports, concurrency: cfg.concurrency,
    maskSelectors: cfg.maskSelectors,
  });
  const s = engine.status();
  return { engine, total: s.total, pending: s.pending, nextPath: engine.nextPage()?.path };
}
