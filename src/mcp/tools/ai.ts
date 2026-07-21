import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import { filterModels } from './model-scope';

/** Catalog tools: AI services, models, and detailed model info. */
export const aiTools: SyntxTool[] = [
  {
    name: 'list-ai-services',
    description: 'List all syntx.ai AI services (e.g. ChatGPT, Midjourney, Sora) with their scope and status.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        const services = await ctx.syntx.ai.listServices();
        return textResult(JSON.stringify(services, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-ai-services');
      }
    },
  },
  {
    name: 'list-models',
    description:
      'List AI models with upload constraints, supported media types, and features. ' +
      'Filters (all optional, combined with AND): `scope` (text|image|video|audio|upscale), ' +
      '`ai_name` (exact match, e.g. "chatgpt"), `active_only` (default true), ' +
      '`search` (case-insensitive substring against `value`/`label`).',
    inputSchema: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          enum: ['text', 'image', 'video', 'audio', 'upscale'],
          description:
            'Capability bucket inferred from the syntx.ai provider. ' +
            'Omit to receive models from every bucket (including providers that don\'t match any known bucket).',
        },
        ai_name: {
          type: 'string',
          description: 'Exact syntx.ai provider name, e.g. "chatgpt", "claude", "midjourney".',
        },
        active_only: {
          type: 'boolean',
          default: true,
          description: 'When true (default), drop inactive models. Set false to include them.',
        },
        search: {
          type: 'string',
          description: 'Case-insensitive substring matched against the model `value` and `label`.',
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const models = await ctx.syntx.ai.listModels();
        const filtered = filterModels(models, {
          scope: args.scope as 'text' | 'image' | 'video' | 'audio' | 'upscale' | undefined,
          ai_name: args.ai_name as string | undefined,
          active_only: args.active_only === undefined ? true : Boolean(args.active_only),
          search: args.search as string | undefined,
        });
        return textResult(JSON.stringify(filtered, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-models');
      }
    },
  },
  {
    name: 'get-model-info',
    description: 'Return detailed information about a specific AI model (pricing/cost params, limits).',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: { type: 'string', description: 'AI service name, e.g. "chatgpt".' },
        model_type: { type: 'string', description: 'Model identifier, e.g. "gpt-5-mini".' },
        batch_size: { type: 'number' },
        quality: { type: 'string' },
        video_duration: { type: 'number' },
        chars_count: { type: 'number' },
        mode: { type: 'string' },
      },
      required: ['ai_name', 'model_type'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      try {
        const info = await ctx.syntx.ai.getModelInfo({
          ai_name: String(args.ai_name),
          model_type: String(args.model_type),
          batch_size: args.batch_size as number | undefined,
          quality: args.quality as string | undefined,
          video_duration: args.video_duration as number | undefined,
          chars_count: args.chars_count as number | undefined,
          mode: args.mode as string | undefined,
        });
        return textResult(JSON.stringify(info, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-model-info');
      }
    },
  },
];