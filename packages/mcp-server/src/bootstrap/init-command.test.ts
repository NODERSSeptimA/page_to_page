import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInitCommand } from './init-command.js';

describe('runInitCommand', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-init-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates config, .mcp.json, gitignore entries', () => {
    runInitCommand({ cwd: dir, originUrl: 'https://origin.example.com', targetUrl: 'http://localhost:3000' });
    const cfg = JSON.parse(readFileSync(join(dir, 'page-to-page.config.json'), 'utf-8'));
    expect(cfg.originUrl).toBe('https://origin.example.com');
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers['page-to-page']).toBeDefined();
    const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
    expect(gi).toContain('page-to-page-artifacts/');
    expect(gi).toContain('page-to-page.state.json.bak');
  });

  it('merges into existing .mcp.json', () => {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { other: { command: 'x' } } }, null, 2));
    runInitCommand({ cwd: dir, originUrl: 'https://o', targetUrl: 'https://t' });
    const mcp = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));
    expect(mcp.mcpServers.other).toBeDefined();
    expect(mcp.mcpServers['page-to-page']).toBeDefined();
  });

  it('does not duplicate .gitignore entries', () => {
    writeFileSync(join(dir, '.gitignore'), 'page-to-page-artifacts/\n');
    runInitCommand({ cwd: dir, originUrl: 'https://o', targetUrl: 'https://t' });
    const gi = readFileSync(join(dir, '.gitignore'), 'utf-8');
    const count = (gi.match(/page-to-page-artifacts\//g) ?? []).length;
    expect(count).toBe(1);
  });
});
