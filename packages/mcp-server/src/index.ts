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
  { name: 'mark_has_issues', description: 'Mark current page as having known issues (note optional).', inputSchema: { type: 'object', properties: { note: { type: 'string' } } } },
  { name: 'skip_current', description: 'Skip current page with reason.', inputSchema: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'status', description: 'Get progress summary.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_fix_proposals', description: 'Return structured FixProposal[] for current page, or for specified pagePath.', inputSchema: { type: 'object', properties: { pagePath: { type: 'string' } } } },
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
