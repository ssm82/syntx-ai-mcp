import type { SyntxPrompt } from '../registry';

/**
 * Prompt templates render into MCP prompt messages. They are conversation
 * starters: the assistant is expected to follow up with the relevant tool
 * (e.g. `ask` or `send-message`) to actually execute the intent.
 */
export const promptTemplates: SyntxPrompt[] = [
  {
    name: 'generate-landing',
    description: 'Produce a single-file HTML landing page for a given topic and visual style.',
    arguments: [
      { name: 'topic', description: 'Subject of the landing page.', required: true },
      { name: 'style', description: 'Visual style, e.g. "minimal", "cyberpunk", "corporate".', required: false },
    ],
    async get(args) {
      const topic = args.topic ?? 'a SaaS product';
      const style = args.style ?? 'modern and clean';
      const text = [
        `Generate a complete, self-contained HTML landing page about: ${topic}.`,
        `Visual style: ${style}.`,
        '',
        'Requirements:',
        '- Single .html file with inline CSS and minimal vanilla JS.',
        '- Sections: hero, features, about, pricing, contact/CTA, footer.',
        '- Responsive, accessible (semantic HTML, alt text, contrast).',
        '- No external build tools or CDNs required to view it.',
        '',
        'Use the "ask" tool to send this brief to syntx.ai, then save the returned HTML.',
      ].join('\n');
      return {
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    },
  },
  {
    name: 'summarize-chat',
    description: 'Summarize the message history of a syntx.ai chat.',
    arguments: [{ name: 'chat_uuid', description: 'UUID of the chat to summarize.', required: true }],
    async get(args) {
      const uuid = args.chat_uuid ?? '';
      const text =
        `Read the chat at syntx://chat/${uuid}/messages (or use the "get-messages" tool), ` +
        'then produce a concise summary: key topics discussed, decisions made, and any open questions. ' +
        'Reply in bullet points.';
      return {
        messages: [{ role: 'user', content: { type: 'text', text } }],
      };
    },
  },
  {
    name: 'translate',
    description: 'Translate a piece of text into a target language.',
    arguments: [
      { name: 'text', description: 'Text to translate.', required: true },
      { name: 'target_lang', description: 'Target language, e.g. "Russian", "English".', required: true },
    ],
    async get(args) {
      const text = args.text ?? '';
      const target = args.target_lang ?? 'English';
      const prompt =
        `Translate the following text into ${target}. Preserve tone and formatting.\n\n"""\n${text}\n"""`;
      return {
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
      };
    },
  },
  {
    name: 'code-review',
    description: 'Review a code snippet for correctness, style, and security.',
    arguments: [{ name: 'code', description: 'The code to review.', required: true }],
    async get(args) {
      const code = args.code ?? '';
      const prompt =
        'Review the following code. Report bugs, security issues, and style problems, ' +
        'then provide a corrected version with explanations.\n\n```\n' +
        code +
        '\n```';
      return {
        messages: [{ role: 'user', content: { type: 'text', text: prompt } }],
      };
    },
  },
];
