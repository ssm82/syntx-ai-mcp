import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Runtime-configuration tools.
 *
 * These mirror the `set-token` pattern: they let an MCP client adjust the
 * server defaults at runtime so the user does not have to restart the
 * process with new environment variables.
 *
 * - `get-settings`      — read the effective runtime configuration.
 * - `set-default-model` — install a new default model (and optionally
 *                         switch the default AI provider in one step).
 * - `set-default-ai`    — switch the default AI provider.
 */
export const settingsTools: SyntxTool[] = [
  {
    name: 'get-settings',
    capability: {},
    description:
      'Return the current effective runtime configuration: base URL, language, ' +
      'default AI provider, default model, polling/streaming parameters, transport, ' +
      'and whether a token is configured. Use this to verify what `set-default-*` ' +
      'tools have applied.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      try {
        const cfg = ctx.config;
        const snapshot = {
          baseURL: cfg.baseURL,
          lang: cfg.lang,
          defaultAI: cfg.defaultAI,
          defaultModel: cfg.defaultModel ?? null,
          pollInterval: cfg.pollInterval,
          pollTimeout: cfg.pollTimeout,
          transport: cfg.transport,
          httpPort: cfg.httpPort,
          httpHostname: cfg.httpHostname,
          httpAuthEnabled: !!cfg.httpToken,
          streamMode: cfg.streamMode,
          wsURL: cfg.wsURL,
          authenticated: ctx.syntx.auth.isAuthenticated(),
        };
        return textResult(JSON.stringify(snapshot, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-settings');
      }
    },
  },
  {
    name: 'set-default-model',
    capability: {},
    description:
      'Install a new default AI model at runtime. Subsequent chat tools that omit ' +
      '`model_type` will use this value. Pass `null` for `model` to clear the override ' +
      '(revert to whatever the tool caller specifies). Optionally pass `ai_name` to ' +
      'switch the default provider in the same call. Use the `list-models` tool to ' +
      'discover valid `model_type` values for a given provider ' +
      '(example: {"model": "gpt-5-mini-2025-08-07", "ai_name": "chatgpt"}).',
    inputSchema: {
      type: 'object',
      properties: {
        model: {
          type: 'string',
          description:
            'Model identifier as accepted by syntx.ai (run `list-models` to discover valid ' +
            'values, e.g. "gpt-5-mini-2025-08-07"). Pass null to clear.',
          nullable: true,
        },
        ai_name: {
          type: 'string',
          description:
            'Optional. Syntx.ai provider to bind this model to (e.g. "chatgpt", "claude"). ' +
            'If omitted, the current defaultAI is kept.',
        },
      },
      required: ['model'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const rawModel = args.model;
      if (rawModel !== null && typeof rawModel !== 'string') {
        return toMcpError(new Error('"model" must be a string or null'), 'set-default-model');
      }
      const trimmed = typeof rawModel === 'string' ? rawModel.trim() : null;
      if (trimmed === '') {
        return toMcpError(new Error('"model" must not be empty (use null to clear)'), 'set-default-model');
      }

      const rawAi = args.ai_name;
      if (rawAi !== undefined && typeof rawAi !== 'string') {
        return toMcpError(new Error('"ai_name" must be a string when provided'), 'set-default-model');
      }
      const trimmedAi = typeof rawAi === 'string' ? rawAi.trim() : '';
      if (rawAi !== undefined && trimmedAi === '') {
        return toMcpError(new Error('"ai_name" must not be empty when provided'), 'set-default-model');
      }

      try {
        ctx.setDefaultModel(trimmed); // null clears
        if (trimmedAi) ctx.setDefaultAI(trimmedAi);
        const after = {
          defaultAI: ctx.config.defaultAI,
          defaultModel: ctx.config.defaultModel ?? null,
        };
        return textResult(JSON.stringify(after, null, 2));
      } catch (err) {
        return toMcpError(err, 'set-default-model');
      }
    },
  },
  {
    name: 'set-default-ai',
    capability: {},
    description:
      'Switch the default AI provider at runtime (e.g. "chatgpt" → "claude"). ' +
      'Affects all tools that fall back to `defaultAI` when the caller omits `ai_name`.',
    inputSchema: {
      type: 'object',
      properties: {
        ai_name: {
          type: 'string',
          description: 'syntx.ai provider identifier (e.g. "chatgpt", "claude", "midjourney").',
        },
      },
      required: ['ai_name'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const ai = String(args.ai_name ?? '').trim();
      if (!ai) {
        return toMcpError(new Error('"ai_name" must be a non-empty string'), 'set-default-ai');
      }
      try {
        ctx.setDefaultAI(ai);
        return textResult(`Default AI set to "${ctx.config.defaultAI}".`);
      } catch (err) {
        return toMcpError(err, 'set-default-ai');
      }
    },
  },
];
