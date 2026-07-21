import type { SyntxResourceTemplate } from '../registry';

/**
 * Parameterized resource templates. The MCP client fills the `{param}` slots
 * and the server resolves the concrete URI into live data.
 */
export const resourceTemplates: SyntxResourceTemplate[] = [
  {
    uriTemplate: 'syntx://chat/{uuid}/messages',
    name: 'Chat Messages',
    description: 'Message history of a specific chat, addressed by UUID.',
    mimeType: 'application/json',
    async read(_uri, params, ctx) {
      const uuid = params.uuid;
      if (!uuid) throw new Error('Missing required path parameter: uuid');
      const messages = await ctx.syntx.chats.getMessages(uuid, { page_size: 50 });
      return {
        contents: [
          {
            uri: `syntx://chat/${uuid}/messages`,
            mimeType: 'application/json',
            text: JSON.stringify(messages, null, 2),
          },
        ],
      };
    },
  },
];
