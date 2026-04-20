import { z } from 'zod';
import { loadConfig, MigrationEngine } from '@noders/page-to-page-core';

export const InitInput = z.object({ configPath: z.string() });

export async function handleInit(input: z.infer<typeof InitInput>): Promise<{
  discovered: number;
  auth: 'disabled';
  estimatedSeconds: number;
  engine: MigrationEngine;
}> {
  const cfg = loadConfig(input.configPath);
  if (cfg.auth.enabled) {
    throw new Error('auth.enabled is true — auth is a Phase 3 feature. Set auth.enabled to false.');
  }
  const engine = await MigrationEngine.init({
    originUrl: cfg.originUrl, targetUrl: cfg.targetUrl,
    stateFile: cfg.stateFile, artifactsDir: cfg.artifactsDir,
    viewports: cfg.viewports, concurrency: cfg.concurrency,
    maskSelectors: cfg.maskSelectors, extraRoutes: cfg.extraRoutes,
  });
  const discovered = engine.status().total;
  const estimatedSeconds = discovered * cfg.viewports.length * 3;
  return { discovered, auth: 'disabled', estimatedSeconds, engine };
}
