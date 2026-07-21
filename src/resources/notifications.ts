import { BaseClient } from '../client';
import type { NotificationsResponse } from '../types';

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
   * GET /api/v1/notification/unread/count
   */
  async getUnreadCount(): Promise<{ count: number }> {
    return this.client.get<{ count: number }>('/api/v1/notification/unread/count');
  }

  /**
   * Mark a notification as read.
   * PATCH /api/v1/notifications/{id}/read (placeholder — endpoint inferred)
   */
  async markAsRead(id: string): Promise<void> {
    await this.client.patch(`/api/v1/notifications/${id}/read`);
  }
}
