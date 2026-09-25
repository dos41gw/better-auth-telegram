# Security

This page describes the 4.x fork with Better Auth 1.7.x. See [SECURITY.md](../SECURITY.md) for supported versions and private reporting.

## Responsibility boundaries

| Concern | Implementation |
| --- | --- |
| Telegram Widget/Mini App payload verification | Plugin: Web Crypto HMAC, input and timestamp checks |
| OIDC ID-token verification | Plugin: `jose`, fixed Telegram issuer/JWKS URL and algorithm allowlist |
| OAuth state, PKCE and callback processing | Better Auth's native social-login flow |
| Sessions, cookies, hooks, field filtering | Better Auth APIs used by the plugin |
| HTTP rate limits | Plugin supplies route rules; Better Auth enforces them |
| Origin/CSRF checks | Better Auth; custom HMAC sign-in routes also use its `formCsrfMiddleware` |
| Unique Telegram identities | Plugin declares schema constraints; the application must migrate its database |
| MFA, captcha, proxy trust and deployment policy | Application configuration; see limitations below |

Do not add a second session system or rate limiter merely because these controls are not implemented in the plugin itself.

## HMAC verification and replay limits

Widget verification derives the key with `SHA256(botToken)`. Mini Apps derive it with `HMAC-SHA256(key="WebAppData", data=botToken)`. Each flow verifies HMAC-SHA-256 over Telegram's sorted data-check string, excluding `hash`, using `crypto.subtle.verify`.

Widget structure is checked before verification. Mini Apps first check the raw input, size, duplicate parameters, timestamp and signature, then parse and validate the user structure. Mini App input is limited to 16 KiB. IDs and timestamps must be positive safe integers. Missing/malformed bodies generally return 400; invalid signatures or out-of-window timestamps return 401 on sign-in. The validation-only endpoint returns `{ valid: false, data: null }` for invalid signed data.

`maxAuthAge` must be positive and finite. Its default is 86,400 seconds; up to 30 seconds of future clock skew is allowed. Choose the shortest window compatible with your flow. Refresh expired Telegram data instead of increasing the window just to hide an error.

**Valid signed payloads can be replayed within their acceptance window.** Better Auth does not turn the plugin's HMAC payloads into single-use credentials. HTTPS and avoiding payload disclosure remain necessary. Strict one-time use would require an application-specific atomic replay store and retry policy; it is not implemented here because Mini App initialization and legitimate retries may reuse data.

## Rate limiting

The plugin registers these rules with Better Auth:

| Path (without the auth base path) | Requests | Window |
| --- | --- | --- |
| `/telegram/signin` | 10 | 60 seconds |
| `/telegram/link` | 5 | 60 seconds |
| `/telegram/unlink` | 5 | 60 seconds |
| `/telegram/miniapp/signin` | 10 | 60 seconds |
| `/telegram/miniapp/validate` | 20 | 60 seconds |

`/telegram/config` has no plugin-specific rule; it and the native OIDC routes use applicable Better Auth rules. Better Auth enables its limiter by default in production, disables it by default in development, and lets application `customRules` override or disable route limits. HTTP handler requests are limited; direct server `auth.api` calls bypass the HTTP limiter.

To explicitly enable it in a test/development deployment:

```ts
betterAuth({
  rateLimit: { enabled: true },
  // database, secret, plugins, etc.
});
```

Configure trusted proxy/IP handling for your deployment. In 1.7.6, missing trusted IPs fall back to a shared per-path bucket unless IP tracking is disabled. In-memory counters are process-local; use Better Auth's supported shared storage for multiple instances. See [Better Auth rate limiting](https://www.better-auth.com/docs/concepts/rate-limit) for configuration and atomic storage requirements.

## OIDC

Better Auth generates and validates OAuth state and PKCE. The plugin validates the resulting ID token before using its profile, including in code callbacks where `getUserInfo` is called directly. Account identity remains the verified `sub`, which is distinct from the optional numeric Telegram `id`.

Accepted algorithms: RS256, ES256 and EdDSA. ES256K is rejected because the Web Crypto/jose implementation does not support it. Telegram restricts EdDSA to `openid`; use `scopes: ["openid"]` without phone or bot-access requests. See [Telegram's specification](https://core.telegram.org/bots/telegram-login).

JWKS caching is intentional: `jose` caches for up to 10 minutes, coalesces fetches, and handles unknown-key refreshes subject to a 30-second cooldown. Each network fetch has `jwksFetchTimeoutMs` (default 10,000 ms); redirects are rejected. A newly rotated key can temporarily fail during the cooldown. Cached keys may remain usable until refresh; do not describe caching as immediate key revocation.

`requireNonce: true` requests a server-generated nonce bound to redirect-flow state and verifies the callback token against it. It is opt-in. On direct-token sign-in, comparing a supplied token nonce is **not** a single-use, server-issued challenge protocol. Applications using SDK tokens must manage that lifecycle themselves. Set `disableIdTokenSignIn: true` when only redirect login is needed. Expiry and audience checks also do not prevent replay of a still-valid direct token.

## Sessions, CSRF and account links

Better Auth supplies session token generation/storage, cookie handling, expiry, and origin validation. Its cookies default to HttpOnly and SameSite=Lax; secure-cookie behavior follows the configured URL/environment. Do not disable origin/CSRF checks to work around a deployment error. Keep `baseURL`, `trustedOrigins`, proxy configuration and framework CORS settings consistent.

The custom HMAC routes call Better Auth's provisioning/session APIs, so hooks, validation and admin session-creation restrictions apply. Output parsers remove `returned:false` fields. Returning-user validation receives the stored user; profile mapping does not establish ownership.

Link/unlink read authoritative session state instead of accepting a stale cookie cache and respect `session.freshAge`. Core `account.accountLinking.enabled: false` disables custom linking too. The last account cannot be unlinked unless `allowUnlinkingAll` is explicitly enabled. Ownership is never inferred from placeholder email or `user.telegramId` alone.

Both `user.telegramId` and `account.telegramId` need unique nullable database constraints. Hook vetoes roll back multi-write operations only on adapters with working transactions. Follow the [migration guide](security-compatibility-audit.md#migration-from-3x); declarations alone do not change a deployed database.

## Integration limits

- Enabling `twoFactor()` does not automatically add a local MFA challenge to custom Telegram routes. Enforce and test any required step-up policy in the consuming application.
- Captcha/BotID defaults may not cover `/telegram/*`; add the exact routes you want protected.
- Anonymous-user upgrade hooks do not automatically match the custom HMAC paths. Native OIDC uses the core social-login paths.
- `input: false` protects fields processed through Better Auth's input parsers, not arbitrary SQL or custom endpoints. Core also filters these fields from ordinary OIDC profile mapping; assigning `telegramPhoneNumber` in a mapper does not bypass this restriction. Use a separately designed, trusted persistence path for sensitive additional claims.
- A verified Mini App payload may contain no `user`; validation can succeed while sign-in rejects it. Neither validation nor successful login grants access to a particular application resource without authorization checks.

## Secrets and reporting

Keep bot tokens, Web Login secrets and `BETTER_AUTH_SECRET` on the server. The public config endpoint returns only bot username and feature flags. Do not log `initData`, Widget hashes, ID tokens, session tokens, or legacy redirect query strings; also review application hooks and proxy logs.

Report suspected vulnerabilities through the [private reporting channel](../SECURITY.md#reporting-a-vulnerability). No live Telegram login or exhaustive deployment/adapter certification is implied by the [automated audit](security-compatibility-audit.md).
