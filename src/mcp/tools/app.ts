import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Public frontend metadata tools.
 *
 * These wrap `syntx.app.getVersion` and `syntx.app.getMaintenanceStatus`, which
 * read the public `syntx.ai` domain (NOT `api.syntx.ai`). They do NOT require
 * an authenticated user and are safe to expose unconditionally.
 *
 * - `get-version`            — current deployed app version (from version.json).
 * - `get-maintenance-status` — whether the platform is under maintenance
 *                              (from maintenance-status.json).
 */
export const appTools: SyntxTool[] = [
  {
    name: 'get-version',
    capability: { networkCall: true },
    description:
      'Return the current deployed syntx.ai frontend version. Mirrors ' +
      '`syntx.app.getVersion`. Fetches `https://syntx.ai/version.json`. ' +
      'No authentication required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        const result = await ctx.syntx.app.getVersion();
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-version');
      }
    },
  },
  {
    name: 'get-maintenance-status',
    capability: { networkCall: true },
    description:
      'Return whether the syntx.ai platform is currently under maintenance. ' +
      'Mirrors `syntx.app.getMaintenanceStatus`. Fetches ' +
      '`https://syntx.ai/maintenance-status.json`. No authentication required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        const result = await ctx.syntx.app.getMaintenanceStatus();
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-maintenance-status');
      }
    },
  },
];