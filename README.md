# Better Auth Telegram

Telegram authentication for Better Auth: native OIDC, legacy Login Widget, Mini Apps, and explicit account linking.

This is the [dos41gw fork](https://github.com/dos41gw/better-auth-telegram), based on [vcode-sh/better-auth-telegram](https://github.com/vcode-sh/better-auth-telegram). The current fork version is **4.0.0** and targets Better Auth **1.7.x**. The upstream npm package does not contain these changes.

[![CI](https://github.com/dos41gw/better-auth-telegram/actions/workflows/ci.yml/badge.svg)](https://github.com/dos41gw/better-auth-telegram/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Requirements and installation

- Node 24+ or Bun; CI tests Node 24 and Bun 1.4.2.
- Matching `better-auth` and `@better-auth/core` versions in `>=1.7.0 <1.8.0`; tested with 1.7.0 and 1.7.6.
- A configured Better Auth database and framework handler, Telegram credentials for the selected flow, and a registered HTTPS application URL.

```sh
bun add better-auth@1.7.6 @better-auth/core@1.7.6
bun add github:dos41gw/better-auth-telegram#main
```

Pin a commit instead of `main` for reproducible installs. Built ESM/CJS exports and declarations are committed; consumers do not need to run build scripts. Web Crypto is used for verification, but arbitrary edge runtimes and adapters are not exhaustively tested.

## Upgrading to 4.0.0

**Migrate unique nullable `user.telegramId` and `account.telegramId` constraints before deploying.** Resolve duplicates and backfill verified existing account metadata first. No migration runs automatically. Follow the [migration guide](docs/security-compatibility-audit.md#migration-from-3x), including Better Auth's version-specific schema changes.

- Mini App signature verification is mandatory; `validateInitData:false` throws.
- Widget/Mini App provisioning runs Better Auth hooks and validation, filters private output fields, and uses its session APIs.
- Account ownership comes from provider-account records, never email or `user.telegramId` alone. Metadata-only users must authenticate with an existing method and explicitly link Telegram.
- Link/unlink use authoritative sessions and honor freshness/linking/last-account policies.
- OIDC verifies tokens on callback and direct-token paths, preserves verified `sub` identities, and supports native signup policies, login hints, nonce opt-in and extra authorization parameters.

## OIDC browser login

Register your origin and exact callback URL (normally `/api/auth/callback/telegram-oidc`) in BotFather's Login Widget/Web Login settings. Use the separate Web Login Client ID and Client Secret. Follow [Telegram's official setup](https://core.telegram.org/bots/telegram-login).

Add to your existing Better Auth server configuration:

```ts
import { telegram } from "better-auth-telegram";

const telegramPlugin = telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
  },
});
// Include telegramPlugin in betterAuth({ ...yourConfig, plugins: [...] }).
```

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({ plugins: [telegramClient()] });
await authClient.signInWithTelegramOIDC({ callbackURL: "/dashboard" });
```

Better Auth handles state, PKCE, native social routes and sessions. The plugin verifies Telegram's token with `jose`. OIDC-only mode, with Mini Apps also disabled, declares no extra Telegram schema fields. Phone scopes expose claims but do not automatically persist them; see [profile mapping](docs/configuration.md#profile-mapping).

## Widget and Mini Apps

For the legacy Widget, create a bot, keep its token server-side, and register its website domain with BotFather. For Mini Apps, register the HTTPS launch URL.

```ts
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  miniApp: { enabled: true },
});
```

After applying the [schema additions](docs/installation.md#database-schema), initialize the Widget when its DOM container exists:

```ts
await authClient.initTelegramWidget("telegram-login", { size: "large" }, async (data) => {
  const result = await authClient.signInWithTelegram(data);
  if (result.error) {
    // Display a suitable error; do not log the signed payload.
  }
});
```

Inside a Telegram Mini App:

```ts
const result = await authClient.autoSignInFromMiniApp();
// Or: authClient.signInWithMiniApp(window.Telegram.WebApp.initData)
```

Widget and Mini App share the numeric `telegram` provider. OIDC uses `telegram-oidc` and a distinct `sub`. They are not automatically merged. While already authenticated, use `linkTelegram(authData)` / `unlinkTelegram()` for the Widget account; native OIDC linking follows Better Auth's social-account API.

Better Auth's browser client includes cookies by default. Linking requires a valid, sufficiently fresh session; unlinking the last account is blocked by default. See [usage](docs/usage.md) and [troubleshooting](docs/troubleshooting.md).

## Security

- HMAC signatures, input validation and timestamp limits protect Widget/Mini App data. **`maxAuthAge` (default 24 hours) does not prevent replay within the window.**
- OIDC validates RS256/ES256/EdDSA signatures, issuer, audience, expiry, required claims and expected nonces. ES256K is unsupported; JWKS caching and timeouts are bounded.
- The plugin supplies per-route limits to Better Auth; enforcement depends on its enabled state, overrides, trusted IP handling and storage. Direct `auth.api` calls bypass HTTP rate limiting.
- Unique schema constraints must exist in the database. Protected fields use Better Auth's input/output parsers.
- MFA, captcha and anonymous-upgrade policies need explicit integration for custom routes. This is not a certification of every Better Auth feature or deployment.

Read the [security guide](docs/security.md), [audit](docs/security-compatibility-audit.md), and [private reporting policy](SECURITY.md). No live Telegram login was performed during the automated audit.

## Documentation and development

[Installation](docs/installation.md) · [Configuration](docs/configuration.md) · [API reference](docs/api-reference.md) · [Mini Apps](docs/miniapps.md) · [Documentation index](docs/README.md)

The [Next.js demo](test/README.md) uses local SQLite with explicit migrations. [Contributing](CONTRIBUTING.md) describes Bun commands, Biome, tsdown and the CI matrix. The audit passed 375 tests per tested Better Auth version, with 94.87% branch coverage. See [CHANGELOG.md](CHANGELOG.md) for fork changes and upstream history.

## License

[MIT](LICENSE). Originally created by Vibe Code; upstream attribution is retained.
