# Installation

## Requirements and package source

Use Node 24+ or the tested Bun runtime, with both `better-auth` and `@better-auth/core` on matching supported `>=1.7.0 <1.8.0` versions. The development build toolchain needs Node 24.11+. Web Crypto alone does not establish compatibility with every edge runtime or database adapter.

```sh
bun add better-auth@1.7.6 @better-auth/core@1.7.6
bun add github:dos41gw/better-auth-telegram#main
```

Use a commit SHA instead of `main` to pin the fork. The npm package named `better-auth-telegram` belongs to upstream; its release does not include this fork. Compiled `dist/` files are committed for Git installs.

## Configure Telegram

For the legacy Widget, create a bot in [BotFather](https://t.me/botfather), save its token/username and register the website domain with `/setdomain`. For a Mini App, register its HTTPS launch URL.

For OIDC, open the bot's Login Widget/Web Login settings in BotFather, register the website origin and exact callback URL (normally `https://example.com/api/auth/callback/telegram-oidc`), and copy the Web Login Client ID and Client Secret. The Client Secret is distinct from the bot token. Follow [Telegram's current instructions](https://core.telegram.org/bots/telegram-login); no undocumented delete/re-add procedure is required by this plugin.

Use a registered HTTPS development URL or tunnel to test browser and Mini App flows. Keep environment URLs and allowed Telegram URLs aligned.

## Server and client

Add the plugin to an existing Better Auth setup with its database, secret and framework handler configured:

```ts
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  // Retain your database, secret, baseURL and framework configuration.
  plugins: [telegram({
    botToken: process.env.TELEGRAM_BOT_TOKEN!,
    botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  })],
});
```

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({ plugins: [telegramClient()] });
```

Better Auth's browser client already defaults to including credentials. If using plain fetch, a custom transport or multiple origins, verify cookie/CORS behavior; see [troubleshooting](troubleshooting.md#cookies-and-sessions). For React hooks, import `createAuthClient` from `better-auth/react`.

## Database schema

When Widget or Mini App is enabled, these nullable string fields are declared:

| Table | Field | Unique | Client input |
| --- | --- | --- | --- |
| user | telegramId | Yes | No |
| user | telegramUsername | No | No |
| user | telegramPhoneNumber | No | No |
| account | telegramId | Yes | No |
| account | telegramUsername | No | No |

Prisma additions, alongside your complete Better Auth models:

```prisma
model User {
  // Existing Better Auth fields and relations remain here.
  telegramId          String? @unique
  telegramUsername    String?
  telegramPhoneNumber String?
}

model Account {
  // Existing Better Auth fields and relations remain here.
  telegramId       String? @unique
  telegramUsername String?
}
```

Generate and review migrations with the tooling appropriate for your adapter; these fragments are not complete schemas. Apply changes explicitly. For an existing installation, resolve duplicates and backfill account Telegram IDs before adding constraints. Follow the [4.0 migration guide](security-compatibility-audit.md#migration-from-3x), including the core `issuer` differences between early 1.7 and 1.7.6.

OIDC-only setups (`loginWidget:false`, Mini App disabled) omit these extra columns but still need Better Auth's core schema. Requesting the phone scope does not automatically persist a phone number. Plugin-owned `input:false` fields are not populated by ordinary core OIDC profile mapping; see [configuration](configuration.md#profile-mapping).

## Verify

Render a Widget only after its container mounts, or initiate native OIDC from a button. Check sign-in, `/get-session`, sign-out and account-linking policies using the same browser origin. Never log signed payloads or session tokens while troubleshooting. The [demo](../test/README.md) provides an explicit local SQLite setup.
