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
        image_size: {
          type: 'string',
          description:
            'Image size tier, e.g. "1K", "2K", "4K". Required by banana / banana3 / ' +
            'seedream (catalog `get_cost_params: ["image_size"]`). Exposed as a flat ' +
            'top-level field in addition to `model_settings` because some MCP clients ' +
            'cannot pass nested object arguments reliably.',
        },
        aspect_ratio: {
          type: 'string',
          description:
            'Aspect ratio, e.g. "3:4", "16:9", "1:1". Flat top-level alias for the ' +
            'same-named `settings` key the SPA sends.',
        },
        details_quality: {
          type: 'string',
          description:
            'Details level for sora-images gpt-image-2 (its `quality` is the size tier ' +
            '"1K"|"2K"|"4K"; "high" confirmed) and grok_imagine_2 ("low"|"medium"). ' +
            'Flat top-level alias for the same-named `settings` key.',
        },
        batch_size: {
          type: 'number',
          description:
            'Batch size (grok_image, wan_image, seedream-5.0-pro, higgsfield-soul). ' +
            'Flat top-level alias for the same-named `settings` key.',
        },
        ref_count: {
          type: 'number',
          description:
            'Reference image count (sora-images gpt-image-2.5-*, grok_imagine_2). ' +
            'Flat top-level alias for the same-named `settings` key.',
        },
        size: {
          type: 'string',
          description:
            'Size tier for wan_image models ("1K"). Flat top-level alias for the ' +
            'same-named `settings` key.',
        },
        version: {
          type: 'string',
          description:
            'Model version (higgsfield-soul). Flat top-level alias for the ' +
            'same-named `settings` key.',
        },
        rendering_speed: {
          type: 'string',
          description:
            'Rendering speed (ideogram), e.g. "TURBO". Flat top-level alias for the ' +
            'same-named `settings` key.',
        },
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
            image_size: args.image_size as string | undefined,
            aspect_ratio: args.aspect_ratio as string | undefined,
            details_quality: args.details_quality as string | undefined,
            batch_size: args.batch_size as number | undefined,
            ref_count: args.ref_count as number | undefined,
            size: args.size as string | undefined,
            version: args.version as string | undefined,
            rendering_speed: args.rendering_speed as string | undefined,
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
