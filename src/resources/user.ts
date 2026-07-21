import { BaseClient } from '../client';
import type { User, Balance, Subscription, UserSettings } from '../types';

/**
 * Resource for user profile, balance, subscription and settings.
 */
export class UserResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get current user profile.
   * GET /api/v1/user
   */
  async me(): Promise<User> {
    return this.client.get<User>('/api/v1/user');
  }

  /**
   * Get token balance.
   * GET /api/v1/user/balance
   */
  async getBalance(): Promise<Balance> {
    return this.client.get<Balance>('/api/v1/user/balance');
  }

  /**
   * Get active subscription details.
   * GET /api/v1/user/subscription
   */
  async getSubscription(): Promise<Subscription> {
    return this.client.get<Subscription>('/api/v1/user/subscription');
  }

  /**
   * Get user-specific settings.
   * GET /api/v1/user/settings
   */
  async getSettings(): Promise<UserSettings> {
    return this.client.get<UserSettings>('/api/v1/user/settings');
  }
}
