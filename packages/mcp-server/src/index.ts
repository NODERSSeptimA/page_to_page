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
  // `init` subcommand wiring is added in Task 12, not here.

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
