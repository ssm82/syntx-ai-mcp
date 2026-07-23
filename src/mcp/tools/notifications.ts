import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';

/**
 * Notification tools.
 *
 * These mirror the `syntx.notifications.list` / `getUnreadCount` /
 * `markAsRead` / `markAll` SDK methods. The underlying endpoints are:
 *   - `GET  /api/v1/notification/global`
 *   - `GET  /api/v1/notification/unread/count`
 *   - `PATCH /api/v1/notification/mark/global/{id}`
 *   - `PATCH /api/v1/notification/mark/all`
 *
 * Path note: the original SDK targeted `PATCH /api/v1/notifications/{id}/read`
 * (singular `notification` vs plural `notifications`), which returned 404
 * against api.syntx.ai. The SPA-observed `notification/mark/global/{id}` is
 * authoritative (returns 403 auth-gated, same posture as the other endpoints).
 */
export const notificationsTools: SyntxTool[] = [
  {
    name: 'list-notifications',
    capability: { networkCall: true },
    description:
      'Return global notifications with pagination. Mirrors `syntx.notifications.list`. ' +
      'Hits `GET /api/v1/notification/global`.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', minimum: 1, description: 'Maximum number of notifications to return.' },
        offset: { type: 'number', minimum: 0, description: 'Pagination offset.' },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const params: { limit?: number; offset?: number } = {};
      if (args.limit !== undefined) params.limit = Number(args.limit);
      if (args.offset !== undefined) params.offset = Number(args.offset);
      try {
        const result = await ctx.syntx.notifications.list(params);
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'list-notifications');
      }
    },
  },
  {
    name: 'get-unread-notification-count',
    capability: { networkCall: true },
    description:
      'Return the number of unread notifications. Mirrors `syntx.notifications.getUnreadCount`. ' +
      'Hits `GET /api/v1/notification/unread/count`. Returns `{ count: number }`.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        const result = await ctx.syntx.notifications.getUnreadCount();
        return textResult(JSON.stringify(result, null, 2));
      } catch (err) {
        return toMcpError(err, 'get-unread-notification-count');
      }
    },
  },
  {
    name: 'mark-notification-read',
    capability: { networkCall: true },
    description:
      'Mark a single notification as read by its ID. Mirrors `syntx.notifications.markAsRead`. ' +
      'Issues `PATCH /api/v1/notification/mark/global/{id}` (the SPA-observed path; ' +
      '`/api/v1/notifications/{id}/read` returns 404 against the live server).',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Notification ID (required).' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const id = String(args.id ?? '').trim();
      if (!id) {
        return toMcpError(new Error('"id" must be a non-empty string'), 'mark-notification-read');
      }
      try {
        await ctx.syntx.notifications.markAsRead(id);
        return textResult(`Marked notification ${id} as read.`);
      } catch (err) {
        return toMcpError(err, 'mark-notification-read');
      }
    },
  },
  {
    name: 'mark-all-notifications-read',
    capability: { networkCall: true },
    description:
      'Mark every notification as read. Mirrors `syntx.notifications.markAll`. ' +
      'Issues `PATCH /api/v1/notification/mark/all` (the SPA `notification.js:markAllRead` action). ' +
      'No body is required.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handler(_args, ctx) {
      try {
        await ctx.syntx.notifications.markAll();
        return textResult('Marked all notifications as read.');
      } catch (err) {
        return toMcpError(err, 'mark-all-notifications-read');
      }
    },
  },
];