import { BaseClient } from '../client';
import type { UserInternal, PublicUser, Balance, Subscription, UserSettings } from '../types';

/**
 * Forward-compat defence: any field whose name looks secret-shaped is
 * stripped from the public projection even if the upstream API adds new
 * internal identifiers without our knowledge. Matches common naming
 * conventions for tokens, API keys, and HMAC secrets.
 */
const SECRET_LIKE_FIELD = /(?:^|_)(secret|token|api[_-]?key|hmac|hmac_key|client_secret)(?:$|_)/i;

function stripUnknownSecrets<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (SECRET_LIKE_FIELD.test(key)) {
      delete (obj as Record<string, unknown>)[key];
    }
  }
  return obj;
}

/**
 * Resource for user profile, balance, subscription and settings.
 */
export class UserResource {
  constructor(private readonly client: BaseClient) {}

  /**
   * Get current user profile (raw internal shape).
   * GET /api/v1/user
   *
   * The returned object includes internal identifiers (`chatwoot_hmac`,
   * `ym_client_id`) that must never be exposed via MCP tool surfaces.
   * Prefer {@link mePublic} for MCP-facing code.
   */
  async me(): Promise<UserInternal> {
    return this.client.get<UserInternal>('/api/v1/user');
  }

  /**
   * Public projection of the current user profile — safe to expose via MCP.
   *
   * Strips internal identifiers (`chatwoot_hmac`, `ym_client_id`) before
   * returning. The underlying network call still fetches the full payload;
   * the projection happens on the SDK boundary so callers downstream never
   * see the sensitive fields even if a future feature forgets to scrub.
   */
  async mePublic(): Promise<PublicUser> {
    const raw = await this.me();
    return toPublicUser(raw);
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

/**
 * Project a raw internal user payload onto the public shape.
 * Exported so MCP modules that already have a `UserInternal` in hand (e.g.
 * after calling `me()` directly) can sanitise without a second fetch.
 */
export function toPublicUser(user: UserInternal): PublicUser {
  const scrubbed = stripUnknownSecrets({ ...user });
  return {
    id: scrubbed.id,
    user_id: scrubbed.user_id,
    name: scrubbed.name ?? null,
    username: scrubbed.username ?? null,
    email: scrubbed.email ?? null,
    avatar: scrubbed.avatar ?? null,
    auth_services: Array.isArray(scrubbed.auth_services) ? scrubbed.auth_services : [],
  };
}
