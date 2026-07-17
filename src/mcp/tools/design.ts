import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/** Image/design generation tool. */
export const designTools: SyntxTool[] = [
  {
    name: 'generate-image',
    description:
      'Generate one or more images on syntx.ai using a design service (e.g. sora-images, flux). ' +
      'Requires a target chat UUID; the result includes generation metadata returned by the API.',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: {
          type: 'string',
          description: 'Design service name, e.g. "sora-images".',
          default: 'sora-images',
        },
        chat_uuid: { type: 'string', description: 'Target chat UUID (create one with create-chat).' },
        prompt: { type: 'string', description: 'Text prompt describing the image(s).' },
        n: { type: 'number', minimum: 1, description: 'Number of images to generate.', default: 1 },
        model_type: { type: 'string', description: 'Model identifier, e.g. "gpt-image-2".' },
        resolution: { type: 'string', description: 'Image resolution, e.g. "720x1280".' },
        quality: { type: 'string', description: 'Quality level, e.g. "medium" or "high".' },
        image_url: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image URLs.',
        },
      },
      required: ['chat_uuid', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? 'sora-images';
        const result = await ctx.syntx.design.generate(aiName, {
          chat_uuid: String(args.chat_uuid),
          prompt: String(args.prompt),
          settings: {
            n: args.n as number | undefined,
            model_type: args.model_type as string | undefined,
            resolution: args.resolution as string | undefined,
            quality: args.quality as string | undefined,
            image_url: args.image_url as string[] | undefined,
          },
        });
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'generate-image');
      }
    },
  },
];
