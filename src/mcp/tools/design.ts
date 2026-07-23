import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/** Image/design generation tool. */
export const designTools: SyntxTool[] = [
  {
    name: 'generate-image',
    capability: { networkCall: true, costSideEffect: true },
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
        model_settings: {
          type: 'object',
          additionalProperties: true,
          description:
            'Provider-specific settings merged into `body.settings` after the ' +
            'top-level fields above. Use for keys the top-level surface does ' +
            'not expose (e.g. ideogram wants `mode`, `style_type`, `rendering_speed`; ' +
            'seedream wants `stream`, `aspect_ratio` coercion; midjourney wants ' +
            '`version`, `style`, `seed`). Merged AFTER the top-level fields, so ' +
            'values here override them. Only plain JSON values are allowed; ' +
            'arrays and nested objects are passed through verbatim.',
        },
      },
      required: ['chat_uuid', 'prompt'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const aiName = (args.ai_name as string | undefined) ?? 'sora-images';
        const modelSettings = args.model_settings;
        if (modelSettings !== undefined && modelSettings !== null) {
          if (typeof modelSettings !== 'object' || Array.isArray(modelSettings)) {
            throw new Error('model_settings must be a JSON object');
          }
        }
        const bodyParams: {
          chat_uuid: string;
          prompt: string;
          settings: Record<string, unknown>;
          model_settings?: Record<string, unknown>;
        } = {
          chat_uuid: String(args.chat_uuid),
          prompt: String(args.prompt),
          settings: {
            n: args.n as number | undefined,
            model_type: args.model_type as string | undefined,
            resolution: args.resolution as string | undefined,
            quality: args.quality as string | undefined,
            image_url: args.image_url as string[] | undefined,
          },
        };
        if (modelSettings !== undefined && modelSettings !== null) {
          bodyParams.model_settings = modelSettings as Record<string, unknown>;
        }
        const result = await ctx.syntx.design.generate(aiName, bodyParams);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'generate-image');
      }
    },
  },
];
