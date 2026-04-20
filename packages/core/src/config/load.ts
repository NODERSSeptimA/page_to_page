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
