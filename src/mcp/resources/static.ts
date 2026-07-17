import type { SyntxResource } from '../registry';

/**
 * Static (fixed-URI) resources. Each maps a stable `syntx://...` URI to a
 * read-only snapshot fetched live from the SDK.
 */
export const staticResources: SyntxResource[] = [
  {
    uri: 'syntx://models',
    name: 'AI Models Catalog',
    description: 'Full catalog of syntx.ai AI models with upload constraints and features.',
    mimeType: 'application/json',
    async read(ctx) {
      const models = await ctx.syntx.ai.listModels();
      return { contents: [{ uri: 'syntx://models', mimeType: 'application/json', text: JSON.stringify(models, null, 2) }] };
    },
  },
  {
    uri: 'syntx://ai-services',
    name: 'AI Services',
    description: 'Available syntx.ai AI services (ChatGPT, Midjourney, Sora, ...).',
    mimeType: 'application/json',
    async read(ctx) {
      const services = await ctx.syntx.ai.listServices();
      return { contents: [{ uri: 'syntx://ai-services', mimeType: 'application/json', text: JSON.stringify(services, null, 2) }] };
    },
  },
  {
    uri: 'syntx://plans',
    name: 'Subscription Plans',
    description: 'Tariff plans and their descriptions.',
    mimeType: 'application/json',
    async read(ctx) {
      const plans = await ctx.syntx.plans.list(ctx.config.lang);
      return { contents: [{ uri: 'syntx://plans', mimeType: 'application/json', text: JSON.stringify(plans, null, 2) }] };
    },
  },
  {
    uri: 'syntx://settings',
    name: 'Application Settings',
    description:
      'Remote application settings (OAuth providers, AI list, country, IP) merged ' +
      'with the local MCP server configuration (default AI, default model, transport).',
    mimeType: 'application/json',
    async read(ctx) {
      let remote: unknown = null;
      let remoteError: string | null = null;
      try {
        remote = await ctx.syntx.settings.get();
      } catch (err) {
        // Stay best-effort: if the upstream is unreachable the local config
        // is still useful on its own. Surface the error for diagnostics.
        remoteError = err instanceof Error ? err.message : String(err);
      }
      const cfg = ctx.config;
      const local = {
        baseURL: cfg.baseURL,
        wsURL: cfg.wsURL,
        lang: cfg.lang,
        defaultAI: cfg.defaultAI,
        defaultModel: cfg.defaultModel ?? null,
        streamMode: cfg.streamMode,
        transport: cfg.transport,
        httpPort: cfg.httpPort,
        authenticated: ctx.syntx.auth.isAuthenticated(),
      };
      const payload = { remote, remoteError, local };
      return {
        contents: [
          {
            uri: 'syntx://settings',
            mimeType: 'application/json',
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    },
  },
  {
    uri: 'syntx://user/me',
    name: 'Current User Profile',
    description: 'Profile of the authenticated user.',
    mimeType: 'application/json',
    async read(ctx) {
      const user = await ctx.syntx.user.me();
      return { contents: [{ uri: 'syntx://user/me', mimeType: 'application/json', text: JSON.stringify(user, null, 2) }] };
    },
  },
  {
    uri: 'syntx://user/balance',
    name: 'Token Balance',
    description: 'Current token balance of the authenticated user.',
    mimeType: 'application/json',
    async read(ctx) {
      const balance = await ctx.syntx.user.getBalance();
      return { contents: [{ uri: 'syntx://user/balance', mimeType: 'application/json', text: JSON.stringify(balance, null, 2) }] };
    },
  },
];
