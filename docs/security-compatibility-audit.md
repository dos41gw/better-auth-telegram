# Security and compatibility audit — 4.0.0

Reviewed against Better Auth 1.7.0 and 1.7.6 on 2026-09-25. This is a code review plus automated regression testing, not a claim that every third-party plugin, database adapter, or future Better Auth release has been certified. Prefer the latest patched Better Auth 1.7.x; the peer range intentionally excludes 1.8.

## Findings and fixes

| Area | Previous behavior | 4.0.0 |
| --- | --- | --- |
| Widget/Mini App writes | Raw adapter writes skipped provisioning hooks and required user fields | Internal adapter, transactions where supported, timestamps and unverified placeholder email |
| Account ownership | A matching denormalized Telegram ID could silently acquire a login method | Only an existing provider account authenticates; metadata-only matches require explicit linking |
| Mini App signatures | Could be disabled by configuration | Always verified; disabling throws |
| HMAC inputs | Future/invalid timestamps, duplicate query keys and malformed user IDs insufficiently checked | Positive safe integers, bounded lifetime and 30-second future skew, duplicate rejection, 16 KiB initData limit, Web Crypto HMAC verification |
| User/session output | Raw custom fields could leak | Better Auth output parsers honor `returned:false` |
| Link/unlink | Cached/revoked sessions and last-account removal were insufficiently guarded | Authoritative fresh session, core linking policy, last-account protection, hooks and refreshed session cookies |
| First login CSRF | Custom HMAC endpoints lacked the native first-login middleware | Better Auth form-CSRF middleware on both login paths |
| Concurrent identities | Telegram identifiers were not unique | Nullable unique constraints on user/account Telegram IDs |
| Client session state | Custom actions bypassed the dynamic route proxy | Successful custom mutations explicitly notify the session store; failed requests do not |
| OIDC keys | Repeated manual fetching and verification | jose remote JWKS cache, concurrent fetch coalescing, timeout, cooldown and rotation; no redirects |
| OIDC identity/tokens | 1.7 provider API mismatch, previously fixed in 3.0 | Stable verified `sub`, `accountSubject`, ID-token verification on both callback and direct-token paths, issuer/audience/expiry/issued-at/nonce checks |
| OAuth options | Wrapper omitted newer parameters/policies | Native signup restrictions, ID-token disable switch, email policy, optional nonce, loginHint, scopes and additional parameters/data |

## Documentation follow-up

The [current security guide](security.md) corrects inherited claims about one-time replay prevention, always-on rate limits, and automatic cookie/claim handling. Better Auth already provides the relevant session/CSRF/rate-limit machinery; no parallel security layer was added. `testMode` is currently metadata, not a Widget endpoint switch. Core OIDC mapping filters `input:false` fields, including the plugin-owned phone field.

## Compatibility boundaries

- Verified: Widget, Mini App and OIDC callback/direct-token authentication; existing account reuse; PKCE/state and nonce; database hook vetoes and SQL rollback; user validation; admin bans; private additional fields; secondary-storage sessions; custom-session output through `getSession`; link/unlink policies; cookie-cache revocation/freshness; origin checks and rate limits; real client session notifications.
- `user.validateUserInfo` sees custom methods `telegram-widget` / `telegram-miniapp` and actions `create-user`, `sign-in`, `link-account`. Applications that allow-list methods must include them. OIDC uses native `oauth` provisioning.
- Custom session enrichments are returned by `/get-session`; custom login responses retain their existing `{ user, session }` shape with private fields filtered.
- Captcha/BotID route protection must explicitly include `/telegram/signin`, `/telegram/miniapp/signin`, and any link/validation routes you intend to protect. Defaults designed for built-in endpoints do not automatically cover custom endpoints.
- Better Auth two-factor hooks do not automatically challenge these custom HMAC routes, nor every native social flow. Applications requiring local step-up MFA for Telegram must implement/test that policy before granting sensitive access. Do not assume enabling `twoFactor()` is sufficient.
- The anonymous plugin's automatic upgrade hooks match native sign-in/callback routes, not these legacy HMAC paths. Use native OIDC or implement an explicit, tested anonymous-data transfer policy.
- Native OIDC benefits from core social-login integrations. OAuth Proxy deployments, every framework hydration mode, all adapters and unrelated Better Auth features (organizations, billing, passkeys, etc.) were not exhaustively end-to-end tested here.
- SQL tests use in-memory SQLite; production Prisma/Drizzle/Postgres/MySQL/D1/Mongo schema setup and transaction behavior must be verified in the consuming app. Adapters without real transactions cannot promise atomic rollback. Unique constraints remain mandatory.
- No live Telegram login with real credentials was performed. Tests sign cryptographically valid tokens locally and replace only Telegram network transport.
- RS256, ES256 and EdDSA are supported. Telegram documents ES256K too; it is intentionally rejected because the Web Crypto/jose implementation does not support it. EdDSA requires `oidc.scopes: ["openid"]` because Telegram rejects profile/phone scopes with that algorithm.
- Telegram advertises authorization-code authentication, not a refresh-token grant; this plugin does not invent token refresh support.
- `requireNonce` is opt-in. For direct ID tokens, a client-supplied nonce comparison alone is not server-side, single-use replay protection. Prefer the authorization-code flow; use `disableIdTokenSignIn: true` when direct tokens are unnecessary. Applications using SDK tokens must manage their own server-issued nonce lifecycle.
- HMAC payloads are bearer credentials reusable within `maxAuthAge` (default 24 hours). Keep them out of logs and URLs, use HTTPS and choose an appropriate shorter window; one-time replay storage is not implemented.

## Migration from 3.x

1. Back up the database and inspect duplicate non-null `user.telegramId` and `account.telegramId` values. Resolve ownership explicitly; never merge accounts based on a placeholder email or stale metadata.
2. Backfill `account.telegramId = account.accountId` for verified existing `providerId = 'telegram'` rows, checking conflicts first. OIDC accounts keep their own `sub` identity and must not be relabeled as numeric Widget accounts.
3. Generate and review your adapter's migration adding unique nullable Telegram ID constraints. Apply it before deploying 4.0.0. No production migration is run by this repository.
4. Existing users with only `user.telegramId` and no `telegram` account must authenticate through their existing method and explicitly link Telegram. This replaces the unsafe automatic fallback.
5. Early Better Auth 1.7 versions require `account.issuer`; follow core's migration instructions. Existing HMAC accounts use `local:oauth:telegram`; old native OIDC account backfills use `local:oauth:telegram-oidc`. Better Auth 1.7.6 removed that column. Do not change persisted account subjects.
6. Remove `validateInitData:false`, review hook vetoes and signup/linking/MFA/captcha policies, and deploy the updated client and server together. Placeholder emails are unverified and are not deliverable email addresses.

## Dependencies

All retained direct dependencies were updated to current registry versions at review time. The package's only direct runtime dependency is `jose` (JWT validation, JWKS caching and key rotation). Better Auth and its core remain peer dependencies and exact development fixtures.

- Kept TypeScript and Node types for type checks, Vitest/coverage and happy-dom for server/browser tests, Biome for lint/format, and tsdown for ESM/CJS/declaration builds.
- Replaced tsup: its declaration build failed with TypeScript 7. tsdown builds both module formats; its TypeScript 7 integration currently emits an experimental-API warning.
- Removed direct `@better-fetch/fetch`: jose handles JWKS transport. Better Auth may still bring its own fetch dependency transitively.
- Removed unused lint-staged (no hook), Vitest UI and the Ultracite wrapper around Biome.
- The demo now uses Better Auth's native SQLite adapter with `node:sqlite`, removing Prisma/Prisma CLI and redundant better-sqlite3 packages. Removed its unused ESLint setup; it uses the root Biome configuration. Demo migrations are explicit CLI work only.
- The demo retains Next/React, Tailwind/PostCSS and their necessary type/build dependencies. Its dependencies have their own committed Bun lockfile.
- `bun audit --json` returned `{}` for both package and demo lockfiles after updates. This is an advisory database check, not proof of absence of vulnerabilities.

## Validation results

- 375 tests passed with Better Auth 1.7.0 and again with 1.7.6 on Node 24.
- The same 375 tests passed under Bun 1.4.2 (`bun --bun run test`).
- Coverage: 97.10% statements, 94.87% branches; existing thresholds retained.
- Package and demo TypeScript checks passed; ESM/CJS builds and declarations passed.
- Both lockfile advisory audits returned zero findings.

## Sources

- [Better Auth 1.7.6 release](https://github.com/better-auth/better-auth/releases/tag/v1.7.6)
- [Better Auth 1.7 source](https://github.com/better-auth/better-auth/tree/v1.7.6/packages/better-auth/src)
- [Telegram login/OIDC documentation](https://core.telegram.org/bots/telegram-login)
- [Telegram Mini App signature validation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app)
