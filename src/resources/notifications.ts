import { BaseClient } from '../client';
import type { NotificationsResponse, UnreadCount } from '../types';

export interface ListNotificationsParams {
  limit?: number;
  offset?: number;
  [key: string]: string | number | boolean | undefined;
}

/**
 * Resource for notifications.
 */
export class NotificationsResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get global notifications with pagination.
   * GET /api/v1/notification/global
   */
  async list(params?: ListNotificationsParams): Promise<NotificationsResponse> {
    return this.client.get<NotificationsResponse>('/api/v1/notification/global', params);
  }

  /**
   * Get unread notifications count.
   *
   * `GET /api/v1/notification/unread/count`
   *
   * The live endpoint returns `{total: number}`. The v0.2.x SDK declared
   * `{count: number}` and was always `undefined` at runtime — fixed
   * 2026-10-13 to match the wire.
   */
  async getUnreadCount(): Promise<UnreadCount> {
    return this.client.get<UnreadCount>('/api/v1/notification/unread/count');
  }

  /**
   * Mark a single notification as read.
   * PATCH /api/v1/notification/mark/global/{id}
   *
   * The previous SDK implementation targeted `PATCH /api/v1/notifications/{id}/read`
   * but that endpoint returned 404 against api.syntx.ai. The SPA-observed
   * path (`notification/mark/global/{id}`) returns 403 (auth-gated) — same
   * pattern as the other working endpoints — and is therefore authoritative.
   */
  async markAsRead(id: string): Promise<void> {
    await this.client.patch(`/api/v1/notification/mark/global/${encodeURIComponent(id)}`);
  }

  /**
   * Mark every notification as read.
   * PATCH /api/v1/notification/mark/all
   *
   * The SPA fires this from `notification.js:markAllRead` whenever the
   * "mark all" UI action is invoked. No body is required.
   */
  async markAll(): Promise<void> {
    await this.client.patch('/api/v1/notification/mark/all');
  }
}
