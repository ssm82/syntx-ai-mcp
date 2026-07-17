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
    description: 'OAuth providers, available AI list, country code, and client IP.',
    mimeType: 'application/json',
    async read(ctx) {
      const settings = await ctx.syntx.settings.get();
      return { contents: [{ uri: 'syntx://settings', mimeType: 'application/json', text: JSON.stringify(settings, null, 2) }] };
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
