import type { SyntxTool } from '../registry';
import { textResult, toMcpError } from '../errors';
import { SyntxAuthError } from '../../errors';

/**
 * Authentication & identity tools.
 *
 * `whoami` is an identity *check*: it returns an `{ authenticated, user }`
 * shape and NEVER surfaces an MCP error purely because authentication is
 * missing/invalid (401/403) — it simply reports `authenticated: false`.
 * Real failures (network, 5xx) still surface as MCP errors so callers can
 * distinguish "not logged in" from "API unreachable".
 *
 * Contrast with `get-profile` (user.ts), which returns the full profile and
 * raises a clear MCP error when unauthorized. The two tools now differ by
 * *error semantics*, not by field set: both resolve from the same
 * `user.me()` call, so neither trims fields.
 *
 * `set-token` lets an MCP client supply a syntx.ai bearer token at runtime,
 * which is essential for headless servers that are not pre-configured via env.
 */
export const authTools: SyntxTool[] = [
  {
    name: 'whoami',
    description:
      'Return an identity check for the current syntx.ai user: ' +
      '{ authenticated, user } where `user` is the full profile (same fields ' +
      'as get-profile). This tool NEVER errors on missing/invalid tokens — ' +
      'it returns { authenticated: false } instead. Use it to verify ' +
      'authentication status. Real failures (network/API errors) still raise ' +
      'an MCP error so you can tell "not logged in" from "API unreachable".',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      // No token configured locally → no network call needed.
      if (!ctx.syntx.auth.isAuthenticated()) {
        return textResult(JSON.stringify({ authenticated: false, user: null }, null, 2));
      }
      try {
        const user = await ctx.syntx.user.me();
        return textResult(JSON.stringify({ authenticated: true, user }, null, 2));
      } catch (err) {
        // Auth errors (401/403) → report not-authenticated, not an MCP error.
        if (err instanceof SyntxAuthError) {
          return textResult(JSON.stringify({ authenticated: false, user: null }, null, 2));
        }
        // Any other failure (network, 5xx, malformed response) → real error.
        return toMcpError(err, 'whoami');
      }
    },
  },
  {
    name: 'set-token',
    description:
      'Set or replace the syntx.ai bearer token used by the server at runtime. ' +
      'Call this before any authenticated operation if SYNTX_TOKEN was not configured. ' +
      'The token is held in memory only — it is not persisted to disk and is lost ' +
      'when the process restarts. Over the stateless HTTP transport the token applies ' +
      'to the whole process, so HTTP is intended for single-user loopback use only.',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: 'A syntx.ai bearer token.',
        },
      },
      required: ['token'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const token = String(args.token ?? '').trim();
      if (!token) return toMcpError(new Error('token must be a non-empty string'), 'set-token');
      ctx.setToken(token);
      return textResult('Token updated. Use "whoami" or "validate-token" to confirm it works.');
    },
  },
  {
    name: 'validate-token',
    description: 'Check whether the currently configured token is accepted by syntx.ai.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    async handler(_args, ctx) {
      if (!ctx.syntx.auth.isAuthenticated()) {
        return textResult('No token is currently set.');
      }
      try {
        const ok = await ctx.syntx.auth.validateToken();
        return textResult(ok ? 'Token is valid.' : 'Token was rejected by syntx.ai.');
      } catch (err) {
        return toMcpError(err, 'validate-token');
      }
    },
  },
  {
    name: 'start-telegram-auth',
    description:
      'Begin a Telegram-based login on syntx.ai. Calls POST /api/v1/auth/startauth and ' +
      'returns a session UUID together with a t.me deep-link (e.g. ' +
      '"https://telegram.me/syntxaibot?start=auth_<uuid>"). The end user MUST open that ' +
      'link and press Start in the bot — only then will the auth session complete. ' +
      'No token is set yet; pair this tool with `poll-telegram-auth` (or use the ' +
      '`login-telegram` one-shot tool) to obtain and install the JWT bearer token.',
    inputSchema: {
      type: 'object',
      properties: {
        bot_username: {
          type: 'string',
          description:
            'Telegram bot username (without "@"). Defaults to "syntxaibot" — the public ' +
            'bot used by syntx.ai. Override only if you are pointing at a custom bot.',
        },
      },
      additionalProperties: false,
    },
    async handler(args, _ctx) {
      try {
        const { uuid } = await _ctx.syntx.auth.startAuth();
        const botUsername = typeof args.bot_username === 'string' && args.bot_username.trim()
          ? args.bot_username.trim().replace(/^@/, '')
          : 'syntxaibot';
        const deepLink = _ctx.syntx.auth.getTelegramAuthLink(uuid, botUsername);
        return textResult(
          JSON.stringify(
            {
              uuid,
              bot_username: botUsername,
              deep_link: deepLink,
              instructions:
                'Open the deep_link in a browser or Telegram client and press Start. ' +
                'Then call poll-telegram-auth with the same uuid to retrieve the JWT.',
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return toMcpError(err, 'start-telegram-auth');
      }
    },
  },
  {
    name: 'poll-telegram-auth',
    description:
      'Poll the status of an auth session created by `start-telegram-auth`. Calls ' +
      'GET /api/v1/auth/token/{uuid}. The response shape is ' +
      '"{ valid, complete, token? }" — when `complete` becomes true the JWT is ' +
      'installed as the active bearer token via `setToken`, so subsequent tools can ' +
      'call authenticated endpoints immediately. Use `install_token: false` to peek ' +
      'without committing the token.',
    inputSchema: {
      type: 'object',
      properties: {
        uuid: {
          type: 'string',
          description: 'The session UUID returned by `start-telegram-auth`.',
        },
        install_token: {
          type: 'boolean',
          description:
            'If true (default) and the session is complete, install the returned JWT as ' +
            'the active bearer token. Pass false to inspect status without committing.',
          default: true,
        },
      },
      required: ['uuid'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const uuid = String(args.uuid ?? '').trim();
      if (!uuid) return toMcpError(new Error('uuid must be a non-empty string'), 'poll-telegram-auth');
      const install = args.install_token === undefined ? true : Boolean(args.install_token);
      try {
        const status = await ctx.syntx.auth.pollAuthToken(uuid);
        if (install && status.complete && status.token) {
          ctx.setToken(status.token);
        }
        return textResult(
          JSON.stringify(
            {
              ...status,
              token_installed: install && status.complete && !!status.token,
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return toMcpError(err, 'poll-telegram-auth');
      }
    },
  },
  {
    name: 'login-telegram',
    description:
      'One-shot Telegram device-auth flow: creates an auth session, returns the bot ' +
      'deep-link, polls /api/v1/auth/token/{uuid} until completion, and installs the ' +
      'resulting JWT as the active bearer token. The end user MUST open the returned ' +
      'deep_link and press Start in the bot — this tool blocks (up to `timeout_ms`) ' +
      'waiting for that manual action. Suitable for headless drivers that can hand the ' +
      'link to a human (or to a Telegram client) and then wait. For more granular ' +
      'control, use `start-telegram-auth` + `poll-telegram-auth` instead.',
    inputSchema: {
      type: 'object',
      properties: {
        bot_username: {
          type: 'string',
          description: 'Telegram bot username (without "@"). Defaults to "syntxaibot".',
        },
        poll_interval_ms: {
          type: 'number',
          description: 'How often to poll /api/v1/auth/token/{uuid}. Default: 3000 ms.',
          default: 3000,
        },
        timeout_ms: {
          type: 'number',
          description:
            'Maximum time to wait for the user to press Start. Default: 300000 ms (5 min).',
          default: 300000,
        },
      },
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const opts: Parameters<typeof ctx.syntx.auth.loginWithTelegram>[0] = {};
      if (typeof args.bot_username === 'string' && args.bot_username.trim()) {
        opts.botUsername = args.bot_username.trim().replace(/^@/, '');
      }
      if (typeof args.poll_interval_ms === 'number' && args.poll_interval_ms > 0) {
        opts.pollIntervalMs = Math.floor(args.poll_interval_ms);
      }
      if (typeof args.timeout_ms === 'number' && args.timeout_ms > 0) {
        opts.timeoutMs = Math.floor(args.timeout_ms);
      }

      let deepLink: string | undefined;
      let uuid: string | undefined;
      opts.onLink = (link, id) => {
        deepLink = link;
        uuid = id;
      };

      try {
        const result = await ctx.syntx.auth.loginWithTelegram(opts);
        return textResult(
          JSON.stringify(
            {
              ok: true,
              uuid: result.uuid,
              deep_link: result.deepLink,
              token_installed: true,
              elapsed_ms: result.elapsedMs,
              hint: 'JWT installed. Use "whoami" or "get-profile" to confirm.',
            },
            null,
            2,
          ),
        );
      } catch (err) {
        // Surface the partial result (deep-link / uuid) so the caller can resume
        // manually via `poll-telegram-auth` instead of restarting the flow.
        return textResult(
          JSON.stringify(
            {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              uuid,
              deep_link: deepLink,
              hint:
                deepLink && uuid
                  ? 'Retry `poll-telegram-auth` with the same uuid once the user has pressed Start.'
                  : 'No session was created — retry `start-telegram-auth` first.',
            },
            null,
            2,
          ),
        );
      }
    },
  },
  {
    name: 'send-email-otp',
    description:
      'Request a one-time password to be emailed to the user. Calls ' +
      '`POST /api/v1/auth/email/send-otp` with `{ email, ref_uuid, utm }`. ' +
      'No token is set by this call — the user must read the OTP from their ' +
      'inbox and pass it to `verify-email-otp` together with the same `email`. ' +
      'If the server responds with an error (rate-limit, unknown address, …) ' +
      'the failure surfaces as an MCP error.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address to deliver the OTP to.',
        },
        ref_uuid: {
          type: ['string', 'null'],
          description:
            'Optional referral UUID forwarded as-is to the server (matches the `ref_uuid` ' +
            'field in the public API body). Pass `null`/omit for an organic visit.',
        },
        utm: {
          type: 'string',
          description: 'Optional UTM tag forwarded as-is (matches the `utm` field in the body).',
        },
      },
      required: ['email'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const email = String(args.email ?? '').trim();
      if (!email) return toMcpError(new Error('email must be a non-empty string'), 'send-email-otp');
      const opts: Parameters<typeof ctx.syntx.auth.sendEmailOtp>[1] = {};
      if (args.ref_uuid !== undefined && args.ref_uuid !== null) {
        opts.ref_uuid = String(args.ref_uuid);
      }
      if (typeof args.utm === 'string') {
        opts.utm = args.utm;
      }
      try {
        const result = await ctx.syntx.auth.sendEmailOtp(email, opts);
        return textResult(
          JSON.stringify(
            {
              ok: true,
              email,
              result,
              hint: 'Ask the user for the OTP code from their inbox, then call `verify-email-otp`.',
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return toMcpError(err, 'send-email-otp');
      }
    },
  },
  {
    name: 'verify-email-otp',
    description:
      'Exchange an OTP code for a JWT bearer token. Calls ' +
      '`POST /api/v1/auth/email/verify-otp` with `{ email, otp_code, ref_uuid, utm }`. ' +
      'When the response carries a `token` field and `install_token` is true ' +
      '(default), the JWT is installed as the active bearer token so subsequent ' +
      'authenticated tools work without further setup. Pass `install_token: false` ' +
      'to peek at the response without committing a token to the in-process ' +
      'bearer store. The `token` field is **never** echoed in the success payload ' +
      '— only `token_present` (boolean) is reported.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'string',
          description: 'Email address the OTP was delivered to.',
        },
        otp_code: {
          type: 'string',
          description: 'The OTP code from the email.',
        },
        ref_uuid: {
          type: ['string', 'null'],
          description:
            'Referral UUID. Must match the value passed to `send-email-otp` (if any). ' +
            'Pass `null`/omit for an organic visit.',
        },
        utm: {
          type: 'string',
          description: 'UTM tag. Must match the value passed to `send-email-otp` (if any).',
        },
        install_token: {
          type: 'boolean',
          description:
            'If true (default) and the server returns a `token` field, install it as the active ' +
            'bearer token. Pass false to inspect the response without committing.',
          default: true,
        },
      },
      required: ['email', 'otp_code'],
      additionalProperties: false,
    },
    async handler(args, ctx) {
      const email = String(args.email ?? '').trim();
      if (!email) return toMcpError(new Error('email must be a non-empty string'), 'verify-email-otp');
      const install = args.install_token === undefined ? true : Boolean(args.install_token);
      const opts: Parameters<typeof ctx.syntx.auth.verifyEmailOtp>[2] = { install };
      if (args.ref_uuid !== undefined && args.ref_uuid !== null) {
        opts.ref_uuid = String(args.ref_uuid);
      }
      if (typeof args.utm === 'string') {
        opts.utm = args.utm;
      }

      try {
        const result = await ctx.syntx.auth.verifyEmailOtp(email, String(args.otp_code ?? ''), opts);
        const tokenPresent = !!(result && typeof result.token === 'string' && result.token.length > 0);
        // Strip the bearer from the result so it never leaves the process via the JSON-RPC body.
        const sanitizedResult =
          result && typeof result === 'object'
            ? Object.fromEntries(Object.entries(result).filter(([k]) => k !== 'token'))
            : result;
        return textResult(
          JSON.stringify(
            {
              ok: true,
              email,
              token_present: tokenPresent,
              token_installed: install && tokenPresent,
              result: sanitizedResult,
              hint:
                install && tokenPresent
                  ? 'JWT installed. Use "whoami" or "get-profile" to confirm.'
                  : tokenPresent
                    ? '`token` field present in response but `install_token` was false — JWT not committed. ' +
                      'Call `set-token` with the bearer manually if you want to install it.'
                    : 'No `token` field in the response — server did not return a JWT.',
            },
            null,
            2,
          ),
        );
      } catch (err) {
        return toMcpError(err, 'verify-email-otp');
      }
    },
  },
];
