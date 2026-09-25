# Troubleshooting

Use the [fork installation](installation.md), supported Better Auth versions, and the current database schema. Avoid logging signed Telegram data, secrets, or session tokens while debugging.

## Cookies and sessions

Better Auth's browser client already defaults to `credentials:"include"`. Adding the same option again is not a general fix for `NOT_AUTHENTICATED`.

Check the actual request and response in browser DevTools:

1. Does the auth URL match the configured `baseURL` and base path?
2. Was the session cookie accepted, and is it sent on the next request?
3. Are cookie domain/path, Secure and SameSite attributes appropriate for this deployment?
4. For cross-origin requests, does your framework/proxy allow the specific frontend origin and credentials? `trustedOrigins` configures Better Auth's origin validation; it does not replace HTTP CORS configuration. There is no `advanced.cors` option to copy from older versions of this guide.
5. Is the session expired, revoked or too old for a sensitive mutation? Link/unlink deliberately ignores stale cookie-cache authority and respects `session.freshAge`.

Plain fetch and custom transports need appropriate credentials behavior. Browser restrictions on third-party cookies may still apply. Do not disable CSRF/origin validation or weaken cookie attributes merely to suppress an error. Better Auth uses HttpOnly and SameSite=Lax defaults; supported overrides live under `advanced.defaultCookieAttributes` or per-cookie settings, not `cookieSameSite`.

## Widget setup

The container must exist before `initTelegramWidget` runs. Check its ID, bot username (without `@`), BotFather domain, script/frame network requests, and CSP errors. Set only the necessary CSP allowances for your actual framework and Telegram resources; a script-only example is not a complete CSP policy.

Widget initialization may throw; API actions normally return `{ data, error }`. Handle both. Authenticate the payload on the server before displaying protected resources. Use an HTTPS development URL registered with Telegram.

`testMode:true` is configuration metadata in the current implementation; Widget helpers do not select a sandbox endpoint from it. Telegram's OIDC endpoint has no documented test variant.

## HMAC authentication failures

| Result | Check |
| --- | --- |
| 400 `INVALID_AUTH_DATA` | Required Widget fields and types, positive safe integer ID/timestamp |
| 401 `INVALID_AUTHENTICATION` | Correct bot token, untouched signed fields, valid signature and timestamp window |
| 401 `INVALID_MINI_APP_INIT_DATA` | Correct owning bot, raw unmodified initData, no duplicate keys, <=16 KiB, valid timestamp/signature |
| 400 `INVALID_MINI_APP_DATA_STRUCTURE` | Signed JSON user structure is malformed |
| 400 `NO_USER_IN_INIT_DATA` | Valid signed data has no user; it cannot establish a user session |
| 403 `USER_CREATION_DISABLED` | No existing provider account and automatic signup is disabled |
| 409 `TELEGRAM_EXPLICIT_LINK_REQUIRED` | A legacy metadata-only user exists; authenticate by its existing method and link explicitly |
| 500 `BOT_TOKEN_REQUIRED` | An enabled HMAC flow has no runtime token |

Check server clock synchronization and obtain fresh Telegram data when it expires. Increasing `maxAuthAge` increases replay exposure; do not use a week-long window as a generic fix. Never disable Mini App verification: `validateInitData:false` now throws during initialization.

Mini App validation-only requests return `valid:false` for invalid signed data without signing in. A `valid:true` payload may omit `user`; sign-in requires it. Use `initData`, not `initDataUnsafe`, as the server-verifiable input.

## Link/unlink errors

- 401: no authoritative valid session.
- 403 `SESSION_NOT_FRESH`: reauthenticate according to the app's session policy.
- 403 `LINKING_DISABLED`: check both `allowUserToLink` and core `account.accountLinking.enabled`.
- 409: account already owned by another user, already linked, or the current user already has a Widget account. Do not overwrite ownership to resolve it.
- 400 `FAILED_TO_UNLINK_LAST_ACCOUNT`: retain/add another login method. Enable `allowUnlinkingAll` only as an explicit application policy.
- 404 `NOT_LINKED`: there is no `telegram` account for the current user. Native OIDC accounts use a different provider ID and core unlink APIs.

## OIDC

For provider-not-found errors, check `oidc.enabled:true`, both server/client plugins, and supported matching Better Auth/core versions. The native provider name is `telegram-oidc`.

For `invalid_client`, use the Web Login Client ID and separate Client Secret, not the bot token. Register the exact redirect URI and origin according to [Telegram's instructions](https://core.telegram.org/bots/telegram-login). Inspect errors from the actual authorization-code flow; do not assume undocumented BotFather toggle/reset procedures are necessary.

For callback/token rejection, check issuer/client ID, expired token or clock skew, allowed signing algorithm, reachable JWKS endpoint, and nonce policy. JWKS requests time out after 10 seconds by default and keys are cached; new-key rotation can encounter a 30-second refresh cooldown. ES256K is unsupported; EdDSA requires `openid`-only scopes.

`requestPhone:true` requires user consent and only exposes optional claims to the mapper. It does not write a database field. Core filters `input:false` fields from ordinary provider mappings, including the plugin-owned `telegramPhoneNumber`; use an intentional trusted persistence path. Telegram does not provide an email address, so required-email-verification policies need an application-level verified-email flow.

## Rate limits and schema

Development rate limiting is disabled by Better Auth by default; set `rateLimit.enabled:true` to test it. Check overrides, trusted IP resolution and shared storage if behavior differs across instances. Direct `auth.api` calls bypass the HTTP limiter. See [security](security.md#rate-limiting).

Missing columns or uniqueness errors require a reviewed schema/data migration, not dropping the database. Follow the [4.0 upgrade guide](security-compatibility-audit.md#migration-from-3x). Early Better Auth 1.7 used an account issuer column; 1.7.6 removed it. For the local demo, use the explicitly configured SQLite file and [demo instructions](../test/README.md).

## Getting help

For ordinary bugs, open an [issue in this fork](https://github.com/dos41gw/better-auth-telegram/issues) with the fork commit, Better Auth version, runtime/framework/adapter, redacted configuration, and a minimal reproduction. For possible vulnerabilities, use [private reporting](../SECURITY.md), not a public issue.
