import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InitCommandOptions { cwd: string; originUrl: string; targetUrl: string }

export function runInitCommand(opts: InitCommandOptions): void {
  writeConfig(opts);
  mergeMcpJson(opts.cwd);
  appendGitignore(opts.cwd);
}

function writeConfig(opts: InitCommandOptions): void {
  const path = join(opts.cwd, 'page-to-page.config.json');
  if (existsSync(path)) return;
  const cfg = {
    originUrl: opts.originUrl,
    targetUrl: opts.targetUrl,
    viewports: [
      { name: 'mobile',  width: 375,  height: 812 },
      { name: 'tablet',  width: 768,  height: 1024 },
      { name: 'desktop', width: 1440, height: 900 },
    ],
    extraRoutes: [],
    maskSelectors: [],
    concurrency: 4,
    auth: { enabled: false },
    artifactsDir: './page-to-page-artifacts',
    stateFile: './page-to-page.state.json',
  };
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf-8');
}

function mergeMcpJson(cwd: string): void {
  const path = join(cwd, '.mcp.json');
  let existing: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(path)) {
    try { existing = JSON.parse(readFileSync(path, 'utf-8')); } catch { existing = {}; }
  }
  const servers = { ...(existing.mcpServers ?? {}) };
  servers['page-to-page'] = { command: 'npx', args: ['page-to-page-mcp'] };
  const merged = { ...existing, mcpServers: servers };
  writeFileSync(path, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

function appendGitignore(cwd: string): void {
  const path = join(cwd, '.gitignore');
  const desired = ['page-to-page-artifacts/', 'page-to-page.state.json.bak'];
  let current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
  if (current.length > 0 && !current.endsWith('\n')) current += '\n';
  for (const line of desired) {
    const re = new RegExp('^' + line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'm');
    if (!re.test(current)) current += line + '\n';
  }
  writeFileSync(path, current, 'utf-8');
}
