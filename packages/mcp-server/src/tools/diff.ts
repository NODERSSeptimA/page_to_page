import type { MigrationEngine, PixelDiffReport } from '@noders/page-to-page-core';

function format(r: PixelDiffReport) {
  return {
    pagePath: r.pagePath,
    totalIssues: r.totalIssues,
    byViewport: r.viewports.map((v) => ({
      viewport: v.viewport,
      diffPercent: v.diffPercent,
      artifacts: { origin: v.originPath, target: v.targetPath, diff: v.diffPath },
    })),
    artifactsDir: r.artifactsDir,
  };
}

export async function handleDiffCurrent(engine: MigrationEngine) { return format(await engine.diffCurrent()); }
export async function handleVerifyCurrent(engine: MigrationEngine) { return format(await engine.verifyCurrent()); }
