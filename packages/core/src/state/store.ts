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
    renameSync(tmp, this.path);
    try { copyFileSync(this.path, bak); } catch { /* ignore */ }
  }
}
