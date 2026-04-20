# page_to_page Phase 1 (MVP) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working MCP server that walks every page of a site, captures screenshots of origin (Angular) and target (Next.js) across three viewports, emits pixel-level diff reports, and tracks progress in a resumable state file.

**Architecture:** Monorepo with `packages/core` (framework-agnostic migration engine over Playwright + pixelmatch) and `packages/mcp-server` (thin MCP wrapper exposing tools to Claude Code). State in JSON, artifacts on disk. Pixel-diff only in Phase 1; DOM-style diff and `FixProposal` structured output land in Phase 2.

**Tech Stack:** Node 20+, TypeScript strict, npm workspaces, Vitest, Zod, Playwright, pixelmatch, pngjs, `@modelcontextprotocol/sdk`, fast-xml-parser, tsx.

**Scope boundaries (explicit):**
- In: discovery (sitemap→crawler→manual), capture across viewports, stabilization injection, masks, pixel diff, state store, MCP tool surface, `init` bootstrap command, integration tests against fixture servers
- Out (Phase 2): DOM-style diff, region matching heuristic, `FixProposal[]` structured output, `get_fix_proposals` tool
- Out (Phase 3): Auth autologin/headful flow (stub only in Phase 1 — `auth.enabled: false` required), real-site smoke tests, ad/tracker blocklists


---

## File structure

```
page_to_page/
├── package.json                              # workspaces root
├── tsconfig.base.json
├── vitest.config.ts
├── .gitignore
├── README.md
├── packages/
│   ├── core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                      # public API barrel
│   │       ├── types.ts                      # Page, PageStatus, ViewportSpec, PixelDiffReport
│   │       ├── config/schema.ts              # Zod config schema
│   │       ├── config/load.ts                # loadConfig(path)
│   │       ├── state/schema.ts               # StateFile Zod
│   │       ├── state/store.ts                # StateStore (atomic writes, .bak)
│   │       ├── discovery/sitemap.ts
│   │       ├── discovery/crawler.ts
│   │       ├── discovery/index.ts            # discoverPages orchestrator
│   │       ├── capture/stabilize.ts          # init script + style tag
│   │       ├── capture/mask.ts               # mask script builder
│   │       ├── capture/viewport.ts           # DEFAULT_VIEWPORTS, resolver
│   │       ├── capture/capturer.ts           # PageCapturer
│   │       ├── diff/pixel.ts                 # pixelmatch wrapper
│   │       └── engine/migration.ts           # MigrationEngine orchestrator
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── bin/page-to-page-mcp              # MCP stdio entry
│       ├── bin/page-to-page                  # CLI entry (init command)
│       └── src/
│           ├── index.ts                      # stdio bootstrap
│           ├── server.ts                     # createServer(engine)
│           ├── tools/init.ts
│           ├── tools/navigation.ts
│           ├── tools/diff.ts
│           ├── tools/lifecycle.ts
│           └── bootstrap/init-command.ts     # `init` subcommand
├── test-fixtures/
│   ├── package.json
│   ├── harness.ts                            # startFixtures()
│   ├── pages.ts                              # shared page definitions
│   ├── origin/server.ts
│   └── target/server.ts
└── docs/superpowers/
    ├── specs/2026-04-20-page-to-page-design.md
    └── plans/2026-04-20-page-to-page-phase1.md
```

---

## Task 1: Monorepo scaffold & tooling

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/src/index.ts`, `packages/core/src/types.ts`
- Create: `packages/mcp-server/package.json`, `packages/mcp-server/tsconfig.json`, `packages/mcp-server/src/index.ts`

- [ ] **Step 1: Write root `package.json`**

```json
{
  "name": "page-to-page",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["packages/*", "test-fixtures"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "typecheck": "tsc -b packages/core packages/mcp-server"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "composite": true,
    "resolveJsonModule": true
  }
}
```

- [ ] **Step 3: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'test-fixtures/**/*.test.ts'],
    testTimeout: 20_000,
  },
});
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
coverage/
page-to-page-artifacts/
page-to-page.state.json.bak
.env
.env.local
```

- [ ] **Step 5: Write `packages/core/package.json`**

```json
{
  "name": "@noders/page-to-page-core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": { "build": "tsc -b" },
  "dependencies": {
    "fast-xml-parser": "^4.5.0",
    "pixelmatch": "^6.0.0",
    "playwright": "^1.49.0",
    "pngjs": "^7.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/pixelmatch": "^5.2.6",
    "@types/pngjs": "^6.0.5"
  }
}
```

- [ ] **Step 6: Write `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.test.ts", "dist"]
}
```

- [ ] **Step 7: Write `packages/core/src/index.ts` and `types.ts` stubs**

`packages/core/src/index.ts`:
```ts
export * from './types.js';
```

`packages/core/src/types.ts`:
```ts
export {};
```

- [ ] **Step 8: Write `packages/mcp-server/package.json`**

```json
{
  "name": "@noders/page-to-page",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "bin": {
    "page-to-page-mcp": "./bin/page-to-page-mcp",
    "page-to-page": "./bin/page-to-page"
  },
  "scripts": { "build": "tsc -b" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@noders/page-to-page-core": "*",
    "zod": "^3.23.0"
  },
  "files": ["dist", "bin"]
}
```

- [ ] **Step 9: Write `packages/mcp-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "references": [{ "path": "../core" }],
  "include": ["src/**/*.ts"],
  "exclude": ["dist"]
}
```

- [ ] **Step 10: Write `packages/mcp-server/src/index.ts` stub**

```ts
export {};
```

- [ ] **Step 11: Install and verify**

```bash
npm install
npm run typecheck
```

Expected: install succeeds; typecheck passes (empty modules compile cleanly).

- [ ] **Step 12: Commit**

```bash
git add .
git commit -m "chore: monorepo scaffold (workspaces, TS strict, Vitest)"
```

---

## Task 2: Shared types

**Files:**
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/src/types.test.ts`

- [ ] **Step 1: Write failing test `packages/core/src/types.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import type { Page, PageStatus, ViewportSpec, PixelDiffReport } from './types.js';
import { DEFAULT_VIEWPORTS } from './types.js';

describe('shared types', () => {
  it('PageStatus covers all 6 states', () => {
    const s: PageStatus[] = ['pending','in_progress','matched','has_issues','skipped','error'];
    expect(s).toHaveLength(6);
  });
  it('Page requires path/status/source/fixHistory', () => {
    const p: Page = { path: '/x', status: 'pending', source: 'sitemap', fixHistory: [] };
    expect(p.path).toBe('/x');
  });
  it('DEFAULT_VIEWPORTS has mobile/tablet/desktop', () => {
    expect(DEFAULT_VIEWPORTS.map((v: ViewportSpec) => v.name)).toEqual(['mobile','tablet','desktop']);
  });
  it('PixelDiffReport shape', () => {
    const r: PixelDiffReport = {
      pagePath: '/x', totalIssues: 0, artifactsDir: 'd',
      viewports: [{ viewport: 'desktop', diffPercent: 0, originPath: 'o', targetPath: 't', diffPath: 'd' }],
    };
    expect(r.viewports[0]!.diffPercent).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run packages/core/src/types.test.ts
```

- [ ] **Step 3: Replace `packages/core/src/types.ts`**

```ts
export type PageStatus = 'pending' | 'in_progress' | 'matched' | 'has_issues' | 'skipped' | 'error';
export type PageSource = 'sitemap' | 'crawl' | 'manual';

export interface FixHistoryEntry { at: string; description: string }

export interface Page {
  path: string;
  status: PageStatus;
  source: PageSource;
  authRequired?: boolean;
  lastRunAt?: string;
  issuesCount?: number;
  skipReason?: string;
  fixHistory: FixHistoryEntry[];
}

export interface ViewportSpec { name: string; width: number; height: number }

export const DEFAULT_VIEWPORTS: ReadonlyArray<ViewportSpec> = Object.freeze([
  { name: 'mobile',  width: 375,  height: 812 },
  { name: 'tablet',  width: 768,  height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
]);

export interface PixelDiffViewportEntry {
  viewport: string;
  diffPercent: number;
  originPath: string;
  targetPath: string;
  diffPath: string;
}

export interface PixelDiffReport {
  pagePath: string;
  viewports: PixelDiffViewportEntry[];
  totalIssues: number;
  artifactsDir: string;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
npx vitest run packages/core/src/types.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/types.test.ts
git commit -m "feat(core): shared types (Page, ViewportSpec, PixelDiffReport)"
```

---

## Task 3: Config schema + loader

**Files:**
- Create: `packages/core/src/config/schema.ts`, `packages/core/src/config/load.ts`, `packages/core/src/config/load.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/config/load.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './load.js';

describe('loadConfig', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-cfg-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('loads minimal config with defaults', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({ originUrl: 'https://o.example.com', targetUrl: 'http://localhost:3000' }));
    const cfg = loadConfig(path);
    expect(cfg.originUrl).toBe('https://o.example.com');
    expect(cfg.viewports).toHaveLength(3);
    expect(cfg.concurrency).toBe(4);
    expect(cfg.auth.enabled).toBe(false);
  });

  it('respects custom viewports', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({
      originUrl: 'https://o', targetUrl: 'https://t',
      viewports: [{ name: 'wide', width: 1920, height: 1080 }],
    }));
    const cfg = loadConfig(path);
    expect(cfg.viewports).toHaveLength(1);
  });

  it('rejects concurrency out of range', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, JSON.stringify({ originUrl: 'https://o', targetUrl: 'https://t', concurrency: 99 }));
    expect(() => loadConfig(path)).toThrow(/concurrency/);
  });

  it('helpful error on missing file', () => {
    expect(() => loadConfig(join(dir, 'missing.json'))).toThrow(/Config file not found/);
  });

  it('helpful error on invalid JSON', () => {
    const path = join(dir, 'cfg.json');
    writeFileSync(path, '{ not json');
    expect(() => loadConfig(path)).toThrow(/parse/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/config/schema.ts`**

```ts
import { z } from 'zod';

export const ViewportSchema = z.object({
  name: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const AuthSchema = z.object({
  enabled: z.boolean().default(false),
  loginUrl: z.string().url().optional(),
  usernameEnv: z.string().optional(),
  passwordEnv: z.string().optional(),
  usernameSelector: z.string().optional(),
  passwordSelector: z.string().optional(),
  submitSelector: z.string().optional(),
  successSelector: z.string().optional(),
  headfulFallbackTimeoutMs: z.number().int().positive().default(300_000),
});

export const ConfigSchema = z.object({
  originUrl: z.string().url(),
  targetUrl: z.string().url(),
  viewports: z.array(ViewportSchema).min(1).default([
    { name: 'mobile',  width: 375,  height: 812 },
    { name: 'tablet',  width: 768,  height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ]),
  extraRoutes: z.array(z.string()).default([]),
  maskSelectors: z.array(z.string()).default([]),
  concurrency: z.number().int().min(1).max(8).default(4),
  auth: AuthSchema.default({ enabled: false }),
  artifactsDir: z.string().default('./page-to-page-artifacts'),
  stateFile: z.string().default('./page-to-page.state.json'),
});

export type Config = z.infer<typeof ConfigSchema>;
```

- [ ] **Step 4: Write `packages/core/src/config/load.ts`**

```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigSchema, type Config } from './schema.js';

export function loadConfig(path: string): Config {
  const abs = resolve(path);
  if (!existsSync(abs)) {
    throw new Error(`Config file not found at ${abs}. Run \`npx page-to-page init\` to create one.`);
  }
  let raw: string;
  try { raw = readFileSync(abs, 'utf-8'); }
  catch (err) { throw new Error(`Failed to read config at ${abs}: ${(err as Error).message}`); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch (err) { throw new Error(`Failed to parse config JSON at ${abs}: ${(err as Error).message}`); }
  const result = ConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '<root>'}: ${i.message}`).join('\n');
    throw new Error(`Invalid config at ${abs}:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Update `packages/core/src/index.ts`**

```ts
export * from './types.js';
export { loadConfig } from './config/load.js';
export type { Config } from './config/schema.js';
```

- [ ] **Step 6: Run — expect PASS**

```bash
npx vitest run packages/core/src/config/load.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/config packages/core/src/index.ts package-lock.json
git commit -m "feat(core): config schema and loader with Zod validation"
```

---

## Task 4: State store (atomic writes + .bak fallback)

**Files:**
- Create: `packages/core/src/state/schema.ts`, `packages/core/src/state/store.ts`, `packages/core/src/state/store.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/state/store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StateStore } from './store.js';

describe('StateStore', () => {
  let dir: string; let path: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-st-')); path = join(dir, 's.json'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates fresh state', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    expect(s.data().pages).toHaveLength(0);
    expect(existsSync(path)).toBe(true);
  });

  it('persists and reloads pages', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([
      { path: '/a', status: 'pending', source: 'sitemap', fixHistory: [] },
      { path: '/b', status: 'pending', source: 'crawl',   fixHistory: [] },
    ]);
    const loaded = StateStore.load(path);
    expect(loaded.data().pages.map((p) => p.path)).toEqual(['/a','/b']);
  });

  it('updatePage is atomic', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    s.updatePage('/x', { status: 'in_progress' });
    expect(s.getPage('/x')!.status).toBe('in_progress');
  });

  it('recovers via .bak when primary corrupts', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    writeFileSync(path, '{ not json');
    const loaded = StateStore.load(path);
    expect(loaded.data().pages).toHaveLength(1);
  });

  it('throws clearly when both primary and .bak corrupt', () => {
    const s = StateStore.create(path, { originUrl: 'https://o', targetUrl: 'https://t' });
    s.addPages([{ path: '/x', status: 'pending', source: 'manual', fixHistory: [] }]);
    writeFileSync(path, 'broken');
    writeFileSync(`${path}.bak`, 'broken');
    expect(() => StateStore.load(path)).toThrow(/unrecoverable|both/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/state/schema.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/core/src/state/store.ts`**

```ts
import { existsSync, readFileSync, renameSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { StateFileSchema, type StateFile, type StatePage } from './schema.js';

export interface CreateStateOptions { originUrl: string; targetUrl: string }

export class StateStore {
  private state: StateFile;
  private constructor(private readonly path: string, initial: StateFile) { this.state = initial; }

  static create(path: string, opts: CreateStateOptions): StateStore {
    const abs = resolve(path);
    mkdirSync(dirname(abs), { recursive: true });
    const initial: StateFile = {
      version: 1, startedAt: new Date().toISOString(),
      originUrl: opts.originUrl, targetUrl: opts.targetUrl, pages: [],
    };
    const s = new StateStore(abs, initial);
    s.flush();
    return s;
  }

  static load(path: string): StateStore {
    const abs = resolve(path);
    const bak = `${abs}.bak`;
    const candidates = [ { file: abs, label: 'primary' }, { file: bak, label: 'backup' } ];
    const errs: string[] = [];
    for (const c of candidates) {
      if (!existsSync(c.file)) { errs.push(`${c.label}: not found`); continue; }
      try {
        const parsed = JSON.parse(readFileSync(c.file, 'utf-8'));
        const v = StateFileSchema.parse(parsed);
        return new StateStore(abs, v);
      } catch (err) { errs.push(`${c.label}: ${(err as Error).message}`); }
    }
    throw new Error(`State unrecoverable (both corrupt):\n${errs.join('\n')}`);
  }

  data(): Readonly<StateFile> { return this.state; }
  getPage(p: string): StatePage | undefined { return this.state.pages.find((x) => x.path === p); }

  addPages(pages: StatePage[]): void {
    const seen = new Set(this.state.pages.map((p) => p.path));
    for (const p of pages) if (!seen.has(p.path)) { this.state.pages.push(p); seen.add(p.path); }
    this.flush();
  }

  updatePage(p: string, patch: Partial<StatePage>): void {
    const i = this.state.pages.findIndex((x) => x.path === p);
    if (i === -1) throw new Error(`Page not in state: ${p}`);
    this.state.pages[i] = { ...this.state.pages[i]!, ...patch };
    this.flush();
  }

  setCurrent(pagePath: string | undefined): void { this.state.current = pagePath; this.flush(); }

  appendFix(p: string, description: string): void {
    const page = this.getPage(p);
    if (!page) throw new Error(`Page not found: ${p}`);
    page.fixHistory.push({ at: new Date().toISOString(), description });
    this.flush();
  }

  private flush(): void {
    const tmp = `${this.path}.tmp`;
    const bak = `${this.path}.bak`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    if (existsSync(this.path)) { try { copyFileSync(this.path, bak); } catch { /* ignore */ } }
    renameSync(tmp, this.path);
  }
}
```

- [ ] **Step 5: Update `packages/core/src/index.ts`**

```ts
export * from './types.js';
export { loadConfig } from './config/load.js';
export type { Config } from './config/schema.js';
export { StateStore } from './state/store.js';
export type { StateFile, StatePage } from './state/schema.js';
```

- [ ] **Step 6: Run — expect PASS**

```bash
npx vitest run packages/core/src/state/store.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/state packages/core/src/index.ts
git commit -m "feat(core): StateStore with atomic writes and .bak recovery"
```

---

## Task 5: Test fixture servers (origin + target with known deltas)

**Files:**
- Create: `test-fixtures/package.json`, `test-fixtures/harness.ts`, `test-fixtures/pages.ts`, `test-fixtures/origin/server.ts`, `test-fixtures/target/server.ts`, `test-fixtures/harness.test.ts`

- [ ] **Step 1: Write `test-fixtures/package.json`**

```json
{
  "name": "@noders/p2p-fixtures",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "express": "^4.21.0" },
  "devDependencies": { "@types/express": "^5.0.0" }
}
```

Run: `npm install`

- [ ] **Step 2: Write `test-fixtures/pages.ts`**

```ts
export interface FixturePage {
  path: string;
  originHtml: string;
  targetHtml: string;
  expectDiff: boolean;
}

const base = (body: string, css: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>fx</title>` +
  `<style>body{margin:0;font-family:sans-serif;background:#fff}${css}</style></head>` +
  `<body>${body}</body></html>`;

export const PAGES: FixturePage[] = [
  {
    path: '/',
    originHtml: base('<h1 class="hero">Welcome</h1><p>Original</p>', '.hero{font-size:56px;color:#111;padding:40px}'),
    targetHtml: base('<h1 class="hero">Welcome</h1><p>Original</p>', '.hero{font-size:48px;color:#111;padding:40px}'),
    expectDiff: true,
  },
  {
    path: '/about',
    originHtml: base('<h1>About</h1><div class="team"><h2>Team</h2></div>', 'h1{font-size:40px}.team{padding:20px;background:#eef}'),
    targetHtml: base('<h1>About</h1>', 'h1{font-size:40px}'),
    expectDiff: true,
  },
  {
    path: '/identical',
    originHtml: base('<h1>Same</h1>', 'h1{font-size:32px}'),
    targetHtml: base('<h1>Same</h1>', 'h1{font-size:32px}'),
    expectDiff: false,
  },
];

export function sitemapXml(origin: string): string {
  const urls = PAGES.map((p) => `  <url><loc>${origin}${p.path}</loc></url>`).join('\n');
  return `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}
```

- [ ] **Step 3: Write `test-fixtures/origin/server.ts`**

```ts
import express from 'express';
import { PAGES, sitemapXml } from '../pages.js';

export function createOriginApp(): express.Express {
  const app = express();
  app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').send(sitemapXml(`http://${req.headers.host}`));
  });
  for (const p of PAGES) app.get(p.path, (_req, res) => res.type('html').send(p.originHtml));
  return app;
}
```

- [ ] **Step 4: Write `test-fixtures/target/server.ts`**

```ts
import express from 'express';
import { PAGES } from '../pages.js';

export function createTargetApp(): express.Express {
  const app = express();
  for (const p of PAGES) app.get(p.path, (_req, res) => res.type('html').send(p.targetHtml));
  return app;
}
```

- [ ] **Step 5: Write `test-fixtures/harness.ts`**

```ts
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOriginApp } from './origin/server.js';
import { createTargetApp } from './target/server.js';

export interface FixtureHandles {
  originUrl: string;
  targetUrl: string;
  stop: () => Promise<void>;
}

async function listen(app: ReturnType<typeof createOriginApp>): Promise<{ url: string; server: Server }> {
  return new Promise((done, fail) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const a = server.address() as AddressInfo;
      done({ url: `http://127.0.0.1:${a.port}`, server });
    });
    server.on('error', fail);
  });
}

export async function startFixtures(): Promise<FixtureHandles> {
  const origin = await listen(createOriginApp());
  const target = await listen(createTargetApp());
  return {
    originUrl: origin.url,
    targetUrl: target.url,
    stop: async () => {
      await Promise.all([
        new Promise<void>((r) => origin.server.close(() => r())),
        new Promise<void>((r) => target.server.close(() => r())),
      ]);
    },
  };
}
```

- [ ] **Step 6: Write `test-fixtures/harness.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { startFixtures } from './harness.js';

describe('fixtures harness', () => {
  it('starts both servers and serves pages + sitemap', async () => {
    const { originUrl, targetUrl, stop } = await startFixtures();
    try {
      const o = await (await fetch(`${originUrl}/`)).text();
      const t = await (await fetch(`${targetUrl}/`)).text();
      expect(o).toContain('Welcome');
      expect(t).toContain('Welcome');
      const sm = await (await fetch(`${originUrl}/sitemap.xml`)).text();
      expect(sm).toContain('<urlset');
    } finally { await stop(); }
  });
});
```

- [ ] **Step 7: Run — expect PASS**

```bash
npx vitest run test-fixtures/harness.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add test-fixtures package-lock.json package.json
git commit -m "feat(fixtures): Express origin+target servers with known deltas"
```

---

## Task 6: Discovery (sitemap + crawler + orchestrator)

**Files:**
- Create: `packages/core/src/discovery/sitemap.ts`, `packages/core/src/discovery/crawler.ts`, `packages/core/src/discovery/index.ts`, `packages/core/src/discovery/discovery.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/discovery/discovery.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { fetchSitemapPaths, crawlPaths, discoverPages } from './index.js';

describe('discovery', () => {
  let fx: FixtureHandles;
  beforeAll(async () => { fx = await startFixtures(); });
  afterAll(async () => { await fx.stop(); });

  it('fetchSitemapPaths returns sitemap paths', async () => {
    const paths = (await fetchSitemapPaths(fx.originUrl)).sort();
    expect(paths).toEqual(['/', '/about', '/identical']);
  });

  it('crawlPaths walks links with depth limit', async () => {
    const paths = await crawlPaths(fx.originUrl, { maxDepth: 2 });
    expect(paths).toContain('/');
  });

  it('discoverPages merges sitemap + manual', async () => {
    const pages = await discoverPages({ originUrl: fx.originUrl, extraRoutes: ['/hidden'] });
    const paths = pages.map((p) => p.path);
    expect(paths).toContain('/');
    expect(paths).toContain('/hidden');
    expect(pages.find((p) => p.path === '/hidden')?.source).toBe('manual');
    expect(pages.find((p) => p.path === '/')?.source).toBe('sitemap');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/discovery/sitemap.ts`**

```ts
import { XMLParser } from 'fast-xml-parser';

export async function fetchSitemapPaths(originUrl: string): Promise<string[]> {
  const base = new URL(originUrl);
  const sitemapUrl = new URL('/sitemap.xml', base).toString();
  let res: Response;
  try { res = await fetch(sitemapUrl); } catch { return []; }
  if (!res.ok) return [];
  const xml = await res.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  let parsed: unknown;
  try { parsed = parser.parse(xml); } catch { return []; }
  const urlset = (parsed as Record<string, unknown>)?.urlset as
    | { url?: Array<{ loc?: string }> | { loc?: string } } | undefined;
  if (!urlset) return [];
  const entries = Array.isArray(urlset.url) ? urlset.url : urlset.url ? [urlset.url] : [];
  const out = new Set<string>();
  for (const e of entries) {
    if (!e.loc) continue;
    try {
      const u = new URL(e.loc);
      if (u.host !== base.host) continue;
      out.add(u.pathname);
    } catch { /* ignore */ }
  }
  return Array.from(out);
}
```

- [ ] **Step 4: Write `packages/core/src/discovery/crawler.ts`**

```ts
export interface CrawlOptions { maxDepth?: number; maxPages?: number }

export async function crawlPaths(originUrl: string, opts: CrawlOptions = {}): Promise<string[]> {
  const maxDepth = opts.maxDepth ?? 3;
  const maxPages = opts.maxPages ?? 500;
  const base = new URL(originUrl);
  const visited = new Set<string>();
  const queue: Array<{ path: string; depth: number }> = [{ path: '/', depth: 0 }];
  while (queue.length > 0 && visited.size < maxPages) {
    const node = queue.shift()!;
    if (visited.has(node.path)) continue;
    visited.add(node.path);
    if (node.depth >= maxDepth) continue;
    let html: string;
    try {
      const res = await fetch(new URL(node.path, base).toString());
      if (!res.ok) continue;
      html = await res.text();
    } catch { continue; }
    for (const href of extractHrefs(html)) {
      try {
        const u = new URL(href, base);
        if (u.host !== base.host) continue;
        const p = u.pathname;
        if (!visited.has(p)) queue.push({ path: p, depth: node.depth + 1 });
      } catch { /* ignore */ }
    }
  }
  return Array.from(visited);
}

function extractHrefs(html: string): string[] {
  const out: string[] = [];
  const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) if (m[1]) out.push(m[1]);
  return out;
}
```

- [ ] **Step 5: Write `packages/core/src/discovery/index.ts`**

```ts
import type { Page } from '../types.js';
import { fetchSitemapPaths } from './sitemap.js';
import { crawlPaths } from './crawler.js';

export { fetchSitemapPaths, crawlPaths };

export interface DiscoveryInput { originUrl: string; extraRoutes?: string[] }

export async function discoverPages(input: DiscoveryInput): Promise<Page[]> {
  const sitemap = await fetchSitemapPaths(input.originUrl);
  const crawl = sitemap.length === 0 ? await crawlPaths(input.originUrl) : [];
  const manual = input.extraRoutes ?? [];
  const seen = new Set<string>();
  const pages: Page[] = [];
  const add = (path: string, source: Page['source']): void => {
    if (seen.has(path)) return;
    seen.add(path);
    pages.push({ path, status: 'pending', source, fixHistory: [] });
  };
  for (const p of sitemap) add(p, 'sitemap');
  for (const p of crawl) add(p, 'crawl');
  for (const p of manual) add(p, 'manual');
  if (pages.length === 0) {
    throw new Error(
      'No pages discovered. Sitemap empty/missing, crawler found nothing, no extraRoutes. ' +
      'Add `extraRoutes` to page-to-page.config.json.',
    );
  }
  return pages;
}
```

- [ ] **Step 6: Update core index, run tests**

```ts
// packages/core/src/index.ts
export * from './types.js';
export { loadConfig } from './config/load.js';
export type { Config } from './config/schema.js';
export { StateStore } from './state/store.js';
export type { StateFile, StatePage } from './state/schema.js';
export { discoverPages, fetchSitemapPaths, crawlPaths } from './discovery/index.js';
```

```bash
npx vitest run packages/core/src/discovery
```

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/discovery packages/core/src/index.ts
git commit -m "feat(core): page discovery (sitemap + crawler + manual override)"
```

---

## Task 7: Stabilization + mask + viewport helpers

**Files:**
- Create: `packages/core/src/capture/stabilize.ts`, `packages/core/src/capture/mask.ts`, `packages/core/src/capture/viewport.ts`, `packages/core/src/capture/stabilize.test.ts`, `packages/core/src/capture/mask.test.ts`

- [ ] **Step 1: Write failing test `stabilize.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { STABILIZE_INIT_SCRIPT, stabilizeStyleTag } from './stabilize.js';
import { resolveViewports } from './viewport.js';
import { DEFAULT_VIEWPORTS } from '../types.js';

describe('stabilization', () => {
  it('init script overrides Date and Math.random', () => {
    expect(STABILIZE_INIT_SCRIPT).toMatch(/Math\.random/);
    expect(STABILIZE_INIT_SCRIPT).toMatch(/Date/);
  });
  it('style tag disables animations and transitions', () => {
    expect(stabilizeStyleTag()).toMatch(/animation:\s*none/);
    expect(stabilizeStyleTag()).toMatch(/transition:\s*none/);
  });
});

describe('viewports', () => {
  it('defaults when unset', () => { expect(resolveViewports(undefined)).toEqual(DEFAULT_VIEWPORTS); });
  it('custom list passed through', () => {
    const c = [{ name: 'wide', width: 1920, height: 1080 }];
    expect(resolveViewports(c)).toEqual(c);
  });
});
```

- [ ] **Step 2: Write failing test `mask.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { buildMaskScript } from './mask.js';

describe('buildMaskScript', () => {
  it('empty returns empty string', () => {
    expect(buildMaskScript([]).trim()).toBe('');
  });
  it('includes all selectors', () => {
    const s = buildMaskScript(['.carousel', '[data-mask]']);
    expect(s).toContain('.carousel');
    expect(s).toContain('[data-mask]');
    expect(s).toContain('background');
  });
  it('uses JSON.stringify to escape selectors (no backtick injection)', () => {
    const s = buildMaskScript(['evil`injected`']);
    expect(s).toContain('"evil`injected`"');
  });
});
```

- [ ] **Step 3: Run — expect FAIL**

- [ ] **Step 4: Write `packages/core/src/capture/stabilize.ts`**

```ts
export const STABILIZE_INIT_SCRIPT = `
(() => {
  const FROZEN_NOW = 1704067200000;
  const OriginalDate = Date;
  const FrozenDate = function (...args) {
    if (args.length === 0) return new OriginalDate(FROZEN_NOW);
    return new OriginalDate(...args);
  };
  FrozenDate.now = () => FROZEN_NOW;
  FrozenDate.parse = OriginalDate.parse;
  FrozenDate.UTC = OriginalDate.UTC;
  FrozenDate.prototype = OriginalDate.prototype;
  globalThis.Date = FrozenDate;
  Math.random = () => 0.5;
})();
`;

export function stabilizeStyleTag(): string {
  return `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`;
}
```

- [ ] **Step 5: Write `packages/core/src/capture/mask.ts`**

```ts
export function buildMaskScript(selectors: ReadonlyArray<string>): string {
  if (selectors.length === 0) return '';
  const jsonSelectors = JSON.stringify(selectors);
  return `
(() => {
  const selectors = ${jsonSelectors};
  for (const sel of selectors) {
    let els;
    try { els = document.querySelectorAll(sel); } catch { continue; }
    els.forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.setProperty('background', '#cccccc', 'important');
      el.style.setProperty('color', 'transparent', 'important');
      el.style.setProperty('border', 'none', 'important');
      el.style.setProperty('box-shadow', 'none', 'important');
      for (const child of Array.from(el.children)) {
        if (child instanceof HTMLElement) child.style.setProperty('visibility', 'hidden', 'important');
      }
    });
  }
})();
`;
}
```

- [ ] **Step 6: Write `packages/core/src/capture/viewport.ts`**

```ts
import { DEFAULT_VIEWPORTS, type ViewportSpec } from '../types.js';

export function resolveViewports(custom: ReadonlyArray<ViewportSpec> | undefined): ReadonlyArray<ViewportSpec> {
  if (!custom || custom.length === 0) return DEFAULT_VIEWPORTS;
  return custom;
}
```

- [ ] **Step 7: Run — expect PASS**

```bash
npx vitest run packages/core/src/capture
```

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/capture
git commit -m "feat(core): stabilization, mask, viewport helpers"
```

---

## Task 8: Page capturer (Playwright orchestrator)

**Files:**
- Create: `packages/core/src/capture/capturer.ts`, `packages/core/src/capture/capturer.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/capture/capturer.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { PageCapturer } from './capturer.js';

describe('PageCapturer', () => {
  let fx: FixtureHandles;
  let artifactsDir: string;
  beforeAll(async () => {
    fx = await startFixtures();
    artifactsDir = mkdtempSync(join(tmpdir(), 'p2p-art-'));
  }, 30_000);
  afterAll(async () => { await fx.stop(); rmSync(artifactsDir, { recursive: true, force: true }); });

  it('captures origin and target for one viewport', async () => {
    const c = await PageCapturer.launch({ concurrency: 2 });
    try {
      const r = await c.capturePage({
        originUrl: fx.originUrl,
        targetUrl: fx.targetUrl,
        pagePath: '/',
        viewports: [{ name: 'desktop', width: 800, height: 600 }],
        maskSelectors: [],
        artifactsDir,
      });
      expect(r.viewportResults).toHaveLength(1);
      const v = r.viewportResults[0]!;
      expect(existsSync(v.originPath)).toBe(true);
      expect(existsSync(v.targetPath)).toBe(true);
      expect(v.originError).toBeUndefined();
      expect(v.targetError).toBeUndefined();
    } finally { await c.close(); }
  }, 60_000);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/capture/capturer.ts`**

```ts
import { chromium, type Browser, type BrowserContext, type Page as PwPage } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ViewportSpec } from '../types.js';
import { STABILIZE_INIT_SCRIPT, stabilizeStyleTag } from './stabilize.js';
import { buildMaskScript } from './mask.js';

export interface CaptureInput {
  originUrl: string;
  targetUrl: string;
  pagePath: string;
  viewports: ReadonlyArray<ViewportSpec>;
  maskSelectors: ReadonlyArray<string>;
  artifactsDir: string;
  storageStatePath?: string;
}

export interface CaptureViewportResult {
  viewport: string;
  originPath: string;
  targetPath: string;
  originError?: string;
  targetError?: string;
}

export interface CaptureResult {
  pagePath: string;
  viewportResults: CaptureViewportResult[];
}

export class PageCapturer {
  private constructor(private readonly browser: Browser, private readonly concurrency: number) {}

  static async launch(opts: { concurrency?: number } = {}): Promise<PageCapturer> {
    const browser = await chromium.launch({ headless: true });
    return new PageCapturer(browser, opts.concurrency ?? 4);
  }

  async close(): Promise<void> { await this.browser.close(); }

  async capturePage(input: CaptureInput): Promise<CaptureResult> {
    const slug = slugify(input.pagePath);
    const baseDir = resolve(input.artifactsDir, slug);
    mkdirSync(baseDir, { recursive: true });
    const tasks = input.viewports.map((vp) => async () => {
      const vpDir = join(baseDir, vp.name);
      mkdirSync(vpDir, { recursive: true });
      const originPath = join(vpDir, 'origin.png');
      const targetPath = join(vpDir, 'target.png');
      const [oErr, tErr] = await Promise.all([
        this.captureSite({ url: joinUrl(input.originUrl, input.pagePath), viewport: vp, output: originPath, maskSelectors: input.maskSelectors, storageStatePath: input.storageStatePath }),
        this.captureSite({ url: joinUrl(input.targetUrl, input.pagePath), viewport: vp, output: targetPath, maskSelectors: input.maskSelectors, storageStatePath: input.storageStatePath }),
      ]);
      return { viewport: vp.name, originPath, targetPath, originError: oErr, targetError: tErr };
    });
    const results = await runPooled(tasks, this.concurrency);
    return { pagePath: input.pagePath, viewportResults: results };
  }

  private async captureSite(opts: {
    url: string; viewport: ViewportSpec; output: string;
    maskSelectors: ReadonlyArray<string>; storageStatePath?: string;
  }): Promise<string | undefined> {
    let ctx: BrowserContext | undefined; let page: PwPage | undefined;
    try {
      ctx = await this.browser.newContext({
        viewport: { width: opts.viewport.width, height: opts.viewport.height },
        storageState: opts.storageStatePath,
      });
      await ctx.addInitScript(STABILIZE_INIT_SCRIPT);
      page = await ctx.newPage();
      const response = await page.goto(opts.url, { waitUntil: 'networkidle', timeout: 30_000 });
      if (!response) return 'no response';
      if (response.status() >= 400) return `HTTP ${response.status()}`;
      await page.addStyleTag({ content: stabilizeStyleTag() });
      const maskScript = buildMaskScript(opts.maskSelectors);
      if (maskScript) await page.evaluate(maskScript);
      await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => { /* best-effort */ });
      const png = await page.screenshot({ fullPage: true, type: 'png' });
      writeFileSync(opts.output, png);
      return undefined;
    } catch (err) { return (err as Error).message; }
    finally {
      await page?.close().catch(() => {});
      await ctx?.close().catch(() => {});
    }
  }
}

function slugify(p: string): string {
  return p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '__');
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString();
}

async function runPooled<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const n = Math.min(concurrency, tasks.length);
  const workers = Array.from({ length: n }, async () => {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  });
  await Promise.all(workers);
  return results;
}
```

- [ ] **Step 4: Update core index**

```ts
// packages/core/src/index.ts — add to existing exports
export { PageCapturer } from './capture/capturer.js';
export type { CaptureInput, CaptureResult, CaptureViewportResult } from './capture/capturer.js';
export { resolveViewports } from './capture/viewport.js';
```

- [ ] **Step 5: Install Playwright browsers and run test**

```bash
npx playwright install chromium
npx vitest run packages/core/src/capture/capturer.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/capture packages/core/src/index.ts
git commit -m "feat(core): PageCapturer over Playwright (stabilize + mask + parallel)"
```

---

## Task 9: Pixel diff engine

**Files:**
- Create: `packages/core/src/diff/pixel.ts`, `packages/core/src/diff/pixel.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/diff/pixel.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PNG } from 'pngjs';
import { pixelDiff } from './pixel.js';

function solid(w: number, h: number, rgba: [number, number, number, number]): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (w * y + x) * 4;
    png.data[i] = rgba[0]; png.data[i+1] = rgba[1]; png.data[i+2] = rgba[2]; png.data[i+3] = rgba[3];
  }
  return PNG.sync.write(png);
}

describe('pixelDiff', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'p2p-px-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('identical images → 0 diff', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    const buf = solid(10, 10, [255, 255, 255, 255]);
    writeFileSync(a, buf); writeFileSync(b, buf);
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBe(0);
    expect(existsSync(d)).toBe(true);
  });

  it('fully different → near 100%', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    writeFileSync(a, solid(10, 10, [255, 255, 255, 255]));
    writeFileSync(b, solid(10, 10, [0, 0, 0, 255]));
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBeGreaterThan(0.9);
  });

  it('normalizes different sizes', async () => {
    const a = join(dir, 'a.png'); const b = join(dir, 'b.png'); const d = join(dir, 'd.png');
    writeFileSync(a, solid(10, 10, [255, 255, 255, 255]));
    writeFileSync(b, solid(20, 20, [255, 255, 255, 255]));
    const r = await pixelDiff(a, b, d);
    expect(r.diffPercent).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/diff/pixel.ts`**

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface PixelDiffResult {
  diffPercent: number;
  width: number;
  height: number;
}

export async function pixelDiff(originPath: string, targetPath: string, diffPath: string): Promise<PixelDiffResult> {
  const origin = PNG.sync.read(readFileSync(originPath));
  const target = PNG.sync.read(readFileSync(targetPath));
  const width = Math.max(origin.width, target.width);
  const height = Math.max(origin.height, target.height);
  const a = normalize(origin, width, height);
  const b = normalize(target, width, height);
  const diff = new PNG({ width, height });
  const mismatch = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1, includeAA: false });
  writeFileSync(diffPath, PNG.sync.write(diff));
  return { diffPercent: mismatch / (width * height), width, height };
}

function normalize(src: PNG, w: number, h: number): PNG {
  if (src.width === w && src.height === h) return src;
  const out = new PNG({ width: w, height: h });
  out.data.fill(0);
  const cw = Math.min(w, src.width);
  const ch = Math.min(h, src.height);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = (src.width * y + x) * 4;
    const di = (w * y + x) * 4;
    out.data[di] = src.data[si]!;
    out.data[di+1] = src.data[si+1]!;
    out.data[di+2] = src.data[si+2]!;
    out.data[di+3] = src.data[si+3]!;
  }
  return out;
}
```

- [ ] **Step 4: Update core index**

```ts
// add to packages/core/src/index.ts
export { pixelDiff } from './diff/pixel.js';
export type { PixelDiffResult } from './diff/pixel.js';
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run packages/core/src/diff/pixel.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/diff packages/core/src/index.ts
git commit -m "feat(core): pixel diff engine with canvas normalization"
```

---

## Task 10: Migration engine (orchestrator)

**Files:**
- Create: `packages/core/src/engine/migration.ts`, `packages/core/src/engine/migration.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/core/src/engine/migration.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startFixtures, type FixtureHandles } from '../../../../test-fixtures/harness.js';
import { MigrationEngine } from './migration.js';

describe('MigrationEngine', () => {
  let fx: FixtureHandles; let work: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });
  beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'p2p-eng-')); });

  it('init → next → diff → mark, then resume', async () => {
    const e = await MigrationEngine.init({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [], extraRoutes: [],
    });
    try {
      expect(e.status().total).toBeGreaterThan(0);
      const np = e.nextPage(); expect(np).toBeDefined();
      const report = await e.diffCurrent();
      expect(report.viewports).toHaveLength(1);
      e.markMatched();
      expect(e.getPage(np!.path)?.status).toBe('matched');
    } finally { await e.close(); }

    const r = await MigrationEngine.resume({
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      concurrency: 2, maskSelectors: [],
    });
    try {
      const matched = r.status().matched;
      expect(matched).toBeGreaterThan(0);
    } finally { await r.close(); }
  }, 120_000);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/core/src/engine/migration.ts`**

```ts
import { StateStore } from '../state/store.js';
import { discoverPages } from '../discovery/index.js';
import { PageCapturer, type CaptureResult } from '../capture/capturer.js';
import { pixelDiff } from '../diff/pixel.js';
import type { Page, ViewportSpec, PixelDiffReport, PixelDiffViewportEntry } from '../types.js';
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const ISSUE_THRESHOLD = 0.001;

export interface MigrationInit {
  originUrl: string; targetUrl: string;
  stateFile: string; artifactsDir: string;
  viewports: ReadonlyArray<ViewportSpec>;
  concurrency: number;
  maskSelectors: ReadonlyArray<string>;
  extraRoutes: ReadonlyArray<string>;
}

export interface MigrationResumeOpts {
  stateFile: string; artifactsDir: string;
  viewports: ReadonlyArray<ViewportSpec>;
  concurrency: number;
  maskSelectors: ReadonlyArray<string>;
}

export interface EngineStatus {
  total: number;
  pending: number; inProgress: number;
  matched: number; hasIssues: number;
  skipped: number; error: number;
  current?: string;
}

export class MigrationEngine {
  private constructor(
    private readonly store: StateStore,
    private readonly capturer: PageCapturer,
    private readonly opts: {
      originUrl: string; targetUrl: string;
      artifactsDir: string;
      viewports: ReadonlyArray<ViewportSpec>;
      maskSelectors: ReadonlyArray<string>;
    },
  ) {}

  static async init(input: MigrationInit): Promise<MigrationEngine> {
    const pages = await discoverPages({ originUrl: input.originUrl, extraRoutes: [...input.extraRoutes] });
    const store = StateStore.create(input.stateFile, { originUrl: input.originUrl, targetUrl: input.targetUrl });
    store.addPages(pages);
    const capturer = await PageCapturer.launch({ concurrency: input.concurrency });
    mkdirSync(input.artifactsDir, { recursive: true });
    return new MigrationEngine(store, capturer, {
      originUrl: input.originUrl, targetUrl: input.targetUrl,
      artifactsDir: input.artifactsDir,
      viewports: input.viewports, maskSelectors: input.maskSelectors,
    });
  }

  static async resume(opts: MigrationResumeOpts): Promise<MigrationEngine> {
    const store = StateStore.load(opts.stateFile);
    const data = store.data();
    const capturer = await PageCapturer.launch({ concurrency: opts.concurrency });
    mkdirSync(opts.artifactsDir, { recursive: true });
    return new MigrationEngine(store, capturer, {
      originUrl: data.originUrl, targetUrl: data.targetUrl,
      artifactsDir: opts.artifactsDir,
      viewports: opts.viewports, maskSelectors: opts.maskSelectors,
    });
  }

  async close(): Promise<void> { await this.capturer.close(); }

  status(): EngineStatus {
    const pages = this.store.data().pages;
    const c = { pending: 0, in_progress: 0, matched: 0, has_issues: 0, skipped: 0, error: 0 };
    for (const p of pages) c[p.status]++;
    return {
      total: pages.length,
      pending: c.pending, inProgress: c.in_progress,
      matched: c.matched, hasIssues: c.has_issues,
      skipped: c.skipped, error: c.error,
      current: this.store.data().current,
    };
  }

  nextPage(): Page | undefined {
    const pages = this.store.data().pages;
    const next = pages.find((p) => p.status === 'pending');
    if (!next) return undefined;
    this.store.updatePage(next.path, { status: 'in_progress' });
    this.store.setCurrent(next.path);
    return this.store.getPage(next.path);
  }

  getPage(path: string): Page | undefined { return this.store.getPage(path); }
  currentPath(): string | undefined { return this.store.data().current; }

  async diffCurrent(): Promise<PixelDiffReport> {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress. Call nextPage() first.');
    return this.diffPath(current);
  }

  async verifyCurrent(): Promise<PixelDiffReport> { return this.diffCurrent(); }

  private async diffPath(pagePath: string): Promise<PixelDiffReport> {
    const cap: CaptureResult = await this.capturer.capturePage({
      originUrl: this.opts.originUrl, targetUrl: this.opts.targetUrl,
      pagePath, viewports: this.opts.viewports,
      maskSelectors: this.opts.maskSelectors, artifactsDir: this.opts.artifactsDir,
    });
    const entries: PixelDiffViewportEntry[] = [];
    let issuesCount = 0;
    for (const vr of cap.viewportResults) {
      if (vr.originError || vr.targetError) {
        issuesCount++;
        entries.push({ viewport: vr.viewport, diffPercent: 1, originPath: vr.originPath, targetPath: vr.targetPath, diffPath: '' });
        continue;
      }
      const diffPath = vr.originPath.replace(/origin\.png$/, 'diff.png');
      const res = await pixelDiff(vr.originPath, vr.targetPath, diffPath);
      if (res.diffPercent > ISSUE_THRESHOLD) issuesCount++;
      entries.push({
        viewport: vr.viewport, diffPercent: res.diffPercent,
        originPath: vr.originPath, targetPath: vr.targetPath, diffPath,
      });
    }
    const artifactsDir = join(this.opts.artifactsDir, slug(pagePath));
    const report: PixelDiffReport = { pagePath, viewports: entries, totalIssues: issuesCount, artifactsDir };
    writeFileSync(join(artifactsDir, 'report.json'), JSON.stringify(report, null, 2));
    this.store.updatePage(pagePath, { lastRunAt: new Date().toISOString(), issuesCount });
    return report;
  }

  markMatched(): void {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress.');
    this.store.updatePage(current, { status: 'matched' });
    this.store.setCurrent(undefined);
  }

  skipCurrent(reason: string): void {
    const current = this.currentPath();
    if (!current) throw new Error('No page in progress.');
    this.store.updatePage(current, { status: 'skipped', skipReason: reason });
    this.store.setCurrent(undefined);
  }
}

function slug(p: string): string { return p === '/' ? 'root' : p.replace(/^\//, '').replace(/\//g, '__'); }
```

- [ ] **Step 4: Update core index**

```ts
export { MigrationEngine } from './engine/migration.js';
export type { MigrationInit, MigrationResumeOpts, EngineStatus } from './engine/migration.js';
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx vitest run packages/core/src/engine/migration.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/engine packages/core/src/index.ts
git commit -m "feat(core): MigrationEngine orchestrator (init, resume, next, diff, mark, skip)"
```

---

## Task 11: MCP server tools surface

**Files:**
- Create: `packages/mcp-server/src/server.ts`, `packages/mcp-server/src/tools/init.ts`, `packages/mcp-server/src/tools/navigation.ts`, `packages/mcp-server/src/tools/diff.ts`, `packages/mcp-server/src/tools/lifecycle.ts`
- Create: `packages/mcp-server/src/server.test.ts`
- Modify: `packages/mcp-server/src/index.ts`, `packages/mcp-server/bin/page-to-page-mcp`

- [ ] **Step 1: Write failing integration test**

```ts
// packages/mcp-server/src/server.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtures, type FixtureHandles } from '../../../test-fixtures/harness.js';
import { createServer } from './server.js';

describe('MCP tools', () => {
  let fx: FixtureHandles; let work: string; let cfgPath: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'p2p-srv-'));
    cfgPath = join(work, 'page-to-page.config.json');
    writeFileSync(cfgPath, JSON.stringify({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      concurrency: 2,
    }));
  });

  it('init → next → diff → mark → status', async () => {
    const srv = createServer();
    try {
      const init = await srv.call('init_migration', { configPath: cfgPath });
      expect(init.discovered).toBeGreaterThan(0);
      const next = await srv.call('next_page', {});
      expect(next.path).toBeDefined();
      const diff = await srv.call('diff_current', {});
      expect(Array.isArray(diff.byViewport)).toBe(true);
      const marked = await srv.call('mark_matched', {});
      expect(marked.pagesRemaining).toBeGreaterThanOrEqual(0);
      const status = await srv.call('status', {});
      expect(status.total).toBeGreaterThan(0);
    } finally { await srv.close(); }
  }, 180_000);

  it('resume returns state from disk', async () => {
    const s1 = createServer();
    await s1.call('init_migration', { configPath: cfgPath });
    await s1.call('next_page', {});
    await s1.close();
    const s2 = createServer();
    try {
      const r = await s2.call('resume', { configPath: cfgPath });
      expect(r.total).toBeGreaterThan(0);
    } finally { await s2.close(); }
  }, 60_000);

  it('verify_current before next_page errors', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      await expect(srv.call('verify_current', {})).rejects.toThrow(/no page in progress/i);
    } finally { await srv.close(); }
  }, 30_000);
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/mcp-server/src/tools/init.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/mcp-server/src/tools/navigation.ts`**

```ts
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
```

- [ ] **Step 5: Write `packages/mcp-server/src/tools/diff.ts`**

```ts
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
```

- [ ] **Step 6: Write `packages/mcp-server/src/tools/lifecycle.ts`**

```ts
import type { MigrationEngine } from '@noders/page-to-page-core';
import { z } from 'zod';

export const SkipInput = z.object({ reason: z.string().min(1) });

export function handleMarkMatched(engine: MigrationEngine): { pagesRemaining: number } {
  engine.markMatched();
  return { pagesRemaining: engine.status().pending };
}

export function handleSkipCurrent(engine: MigrationEngine, input: z.infer<typeof SkipInput>): { pagesRemaining: number } {
  engine.skipCurrent(input.reason);
  return { pagesRemaining: engine.status().pending };
}
```

- [ ] **Step 7: Write `packages/mcp-server/src/server.ts`**

```ts
import type { MigrationEngine } from '@noders/page-to-page-core';
import { handleInit, InitInput } from './tools/init.js';
import { handleNextPage, handleStatus, handleResume, ResumeInput } from './tools/navigation.js';
import { handleDiffCurrent, handleVerifyCurrent } from './tools/diff.js';
import { handleMarkMatched, handleSkipCurrent, SkipInput } from './tools/lifecycle.js';

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
        case 'mark_matched':  return handleMarkMatched(await ensureEngine());
        case 'skip_current':  return handleSkipCurrent(await ensureEngine(), SkipInput.parse(args));
        case 'status':        return handleStatus(await ensureEngine());
        default: throw new Error(`Unknown tool: ${tool}`);
      }
    },
    async close() { if (engine) { await engine.close(); engine = undefined; } },
  };
}
```

- [ ] **Step 8: Write stdio entry `packages/mcp-server/src/index.ts`**

```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createServer } from './server.js';

const TOOLS = [
  { name: 'init_migration', description: 'Initialize migration from config path.', inputSchema: { type: 'object', properties: { configPath: { type: 'string' } }, required: ['configPath'] } },
  { name: 'resume', description: 'Resume migration from existing state.', inputSchema: { type: 'object', properties: { configPath: { type: 'string' } }, required: ['configPath'] } },
  { name: 'next_page', description: 'Advance to next pending page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'diff_current', description: 'Capture + diff current page.', inputSchema: { type: 'object', properties: {} } },
  { name: 'verify_current', description: 'Re-diff current page after edits.', inputSchema: { type: 'object', properties: {} } },
  { name: 'mark_matched', description: 'Mark current page matched.', inputSchema: { type: 'object', properties: {} } },
  { name: 'skip_current', description: 'Skip current page with reason.', inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'status', description: 'Get progress summary.', inputSchema: { type: 'object', properties: {} } },
];

async function main(): Promise<void> {
  if (process.argv[2] === 'init') {
    const { runInitCommand } = await import('./bootstrap/init-command.js');
    const originUrl = process.argv[3] ?? 'https://change-me.example.com';
    const targetUrl = process.argv[4] ?? 'http://localhost:3000';
    runInitCommand({ cwd: process.cwd(), originUrl, targetUrl });
    console.log('page-to-page initialized:');
    console.log('  page-to-page.config.json — edit to configure');
    console.log('  .mcp.json                 — server registered for Claude Code');
    console.log('  .gitignore                — artifacts + state backup ignored');
    process.exit(0);
  }

  const handler = createServer();
  const server = new Server({ name: 'page-to-page', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await handler.call(req.params.name, req.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: (err as Error).message }] };
    }
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const shutdown = (): void => { void handler.close().then(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 9: Write `packages/mcp-server/bin/page-to-page-mcp`**

```
#!/usr/bin/env node
import('../dist/index.js').catch((err) => { console.error(err); process.exit(1); });
```

Run: `chmod +x packages/mcp-server/bin/page-to-page-mcp`

- [ ] **Step 10: Build + run tests**

```bash
npm run build
npx vitest run packages/mcp-server/src/server.test.ts
```

- [ ] **Step 11: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp): server + tools (init, resume, next, diff, verify, mark, skip, status)"
```

---

## Task 12: `init` bootstrap command

**Files:**
- Create: `packages/mcp-server/src/bootstrap/init-command.ts`, `packages/mcp-server/src/bootstrap/init-command.test.ts`
- Create: `packages/mcp-server/bin/page-to-page`

- [ ] **Step 1: Write failing test**

```ts
// packages/mcp-server/src/bootstrap/init-command.test.ts
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
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `packages/mcp-server/src/bootstrap/init-command.ts`**

```ts
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
```

- [ ] **Step 4: Write `packages/mcp-server/bin/page-to-page`**

```
#!/usr/bin/env node
import('../dist/index.js').catch((err) => { console.error(err); process.exit(1); });
```

Run: `chmod +x packages/mcp-server/bin/page-to-page`

- [ ] **Step 5: Build + run tests**

```bash
npm run build
npx vitest run packages/mcp-server/src/bootstrap
```

- [ ] **Step 6: Commit**

```bash
git add packages/mcp-server
git commit -m "feat(mcp): init bootstrap command (config, .mcp.json merge, gitignore)"
```

---

## Task 13: End-to-end integration + README

**Files:**
- Create: `packages/mcp-server/src/e2e.test.ts`
- Create: `README.md`

- [ ] **Step 1: Write full-loop E2E test**

```ts
// packages/mcp-server/src/e2e.test.ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFixtures, type FixtureHandles } from '../../../test-fixtures/harness.js';
import { createServer } from './server.js';

describe('E2E: full migration loop', () => {
  let fx: FixtureHandles; let work: string; let cfgPath: string;
  beforeAll(async () => { fx = await startFixtures(); }, 30_000);
  afterAll(async () => { await fx.stop(); });
  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'p2p-e2e-'));
    cfgPath = join(work, 'page-to-page.config.json');
    writeFileSync(cfgPath, JSON.stringify({
      originUrl: fx.originUrl, targetUrl: fx.targetUrl,
      viewports: [{ name: 'desktop', width: 800, height: 600 }],
      stateFile: join(work, 'state.json'),
      artifactsDir: join(work, 'artifacts'),
      concurrency: 2,
    }));
  });

  it('walks every page, diff detects known deltas, state persists', async () => {
    const srv = createServer();
    try {
      await srv.call('init_migration', { configPath: cfgPath });
      const seenDiffs: Array<{ path: string; diffPercent: number }> = [];
      for (let i = 0; i < 10; i++) {
        const np = await srv.call('next_page', {});
        if (np.done) break;
        const d = await srv.call('diff_current', {});
        for (const v of d.byViewport) seenDiffs.push({ path: d.pagePath, diffPercent: v.diffPercent });
        if (d.totalIssues === 0) await srv.call('mark_matched', {});
        else await srv.call('skip_current', { reason: 'known fixture delta' });
      }
      const home = seenDiffs.find((s) => s.path === '/');
      const about = seenDiffs.find((s) => s.path === '/about');
      const same = seenDiffs.find((s) => s.path === '/identical');
      expect(home!.diffPercent).toBeGreaterThan(0);
      expect(about!.diffPercent).toBeGreaterThan(0);
      expect(same!.diffPercent).toBeLessThan(0.001);
      const status = await srv.call('status', {});
      expect(status.pending).toBe(0);
      expect(existsSync(join(work, 'state.json'))).toBe(true);
      expect(existsSync(join(work, 'artifacts'))).toBe(true);
    } finally { await srv.close(); }
  }, 240_000);
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx vitest run packages/mcp-server/src/e2e.test.ts
```

- [ ] **Step 3: Write `README.md`**

```markdown
# page_to_page

MCP server for Angular → Next.js visual migration. Walks every page of an origin site, captures screenshots across mobile/tablet/desktop viewports, pixel-diffs against the Next.js port, and tracks progress in a resumable state file.

## Install

    npm install --save-dev @noders/page-to-page
    npx page-to-page init https://origin.example.com http://localhost:3000

This creates:
- `page-to-page.config.json` — edit viewports, masks, extraRoutes
- `.mcp.json` entry registering the server for Claude Code
- `.gitignore` additions for artifacts and state backup

## Claude Code tools

- `init_migration({configPath})` — discovery + state bootstrap
- `resume({configPath})` — resume from existing state
- `next_page()` — advance to next pending page
- `diff_current()` — capture + pixel-diff across viewports
- `verify_current()` — re-diff after edits
- `mark_matched()` — accept current page
- `skip_current({reason})` — skip current with note
- `status()` — progress summary

## Phase scope

- **Phase 1 (this release):** pixel-diff, full MCP surface, state, discovery, bootstrap
- **Phase 2:** DOM-style diff, FixProposal[] structured output
- **Phase 3:** auth flow (autologin + headful fallback), real-site smoke

## Development

    npm install
    npx playwright install chromium
    npm test
```

- [ ] **Step 4: Commit**

```bash
git add packages/mcp-server/src/e2e.test.ts README.md
git commit -m "test: E2E integration + README"
```

---

## Task 14: Push to remote

- [ ] **Step 1: Push**

```bash
git remote -v
git push
```

Expected: `main` pushes to `https://github.com/NODERSSeptimA/page_to_page.git`.

---

## Self-review checklist (complete after final task)

1. **Spec coverage:**
   - §4.1 PageDiscoverer → Task 6 ✅
   - §4.2 AuthManager → Out of scope Phase 1 (rejected in init.ts when enabled) ✅
   - §4.3 PageCapturer → Tasks 7, 8 ✅
   - §4.4 DiffEngine → Task 9 (pixel only; DOM is Phase 2) ✅
   - §4.5 StateStore → Task 4 ✅
   - §4.6 MCPTools → Tasks 11, 12 ✅
   - §5 Data flow → Task 10 (engine) + Task 11 (MCP) + Task 13 (E2E) ✅
   - §5.2 FixProposal → Phase 2 ✅
   - §6 Error handling — state `.bak` recovery, per-viewport capture errors, tool-order checks ✅
   - §9 Delivery → Tasks 1, 12 ✅
2. **Placeholders:** none — every step has concrete code/commands.
3. **Type consistency:** `Page`, `PageStatus`, `ViewportSpec`, `PixelDiffReport`, `MigrationEngine` method names match across Task 2/4/10/11.

One intentional loose end: `handleNextPage` returns `viewports: []` — a stable shape for Phase 2 without leaking internals here. `diff_current` does the per-viewport work.
