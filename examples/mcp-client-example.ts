/**
 * Example: connect to the syntx-ai-mcp server as an MCP client (stdio)
 * and call the `ask` tool to get a one-shot answer.
 *
 * Run after `npm run build`:
 *   npx tsx examples/mcp-client-example.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main(): Promise<void> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/bin/cli.js'],
    env: {
      ...process.env,
      SYNTX_TOKEN: process.env.SYNTX_TOKEN ?? '',
    },
  });

  const client = new Client(
    { name: 'syntx-example-client', version: '0.0.0' },
    { capabilities: {} },
  );

  await client.connect(transport);

  // List available tools.
  const { tools } = await client.listTools();
  console.log(
    'Available tools:',
    tools.map((t) => t.name).join(', '),
  );

  // One-shot question through the `ask` tool.
  const result = await client.callTool({
    name: 'ask',
    arguments: { prompt: 'Explain what Model Context Protocol is in two sentences.' },
  });

  console.log('\n--- answer ---');
  for (const block of result.content as Array<{ type: string; text?: string }>) {
    if (block.type === 'text') console.log(block.text);
  }

  await transport.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
