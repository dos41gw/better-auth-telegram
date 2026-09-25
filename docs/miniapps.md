# Telegram Mini Apps

Mini Apps receive signed launch data from Telegram. The server must verify it before establishing an application session; opening the page or reading `initDataUnsafe` is not authentication.

Requires `better-auth@>=1.7.0 <1.8.0`.

## Mini Apps vs Login Widget

Before you commit to a path, know what you're choosing:

| | Login Widget | Mini Apps |
|---|---|---|
| **Where it runs** | Your website | Inside Telegram |
| **User action** | Click & authorize in popup | Automatic (they're already there) |
| **User data** | Name, photo, username | All that + language, premium status, chat context |
| **Start params** | Nope | Yes |
| **Setup effort** | Drop a widget | Register a Mini App with BotFather |

For new browser integrations, consider native OIDC; the Login Widget is the legacy option. If your app lives inside Telegram, you're in the right doc.

## Setup

### 1. Create a Mini App with BotFather

You need a bot first. If you don't have one, `/newbot` in [@BotFather](https://t.me/botfather). Then:

1. Send `/newapp` to BotFather
2. Pick your bot
3. Provide a title, description, icon (512x512 PNG), your HTTPS web app URL, and a short name
4. You get a link: `t.me/yourbot/yourapp`

### 2. Local Dev (HTTPS Required)

Telegram demands HTTPS. For local dev, tunnel it:

```bash
npx ngrok http 3000
```

Update your Mini App URL in BotFather (`/myapps` -> Edit Web App URL) to the ngrok URL.

## Server Configuration

```typescript
import { betterAuth } from "better-auth";
import { telegram } from "better-auth-telegram";

export const auth = betterAuth({
  database: /* your database */,
  plugins: [
    telegram({
      botToken: process.env.TELEGRAM_BOT_TOKEN!,
      botUsername: process.env.TELEGRAM_BOT_USERNAME!,
      miniApp: {
        enabled: true,
      },
    }),
  ],
});
```

That's the minimum. Here's every knob you can turn:

```typescript
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: "mybot",

  // Auto-create users on first sign-in (default: true)
  autoCreateUser: true,

  // Max age of auth_date in seconds, limits the replay window (default: 86400 = 24h)
  maxAuthAge: 86400,

  miniApp: {
    enabled: true,

    // Validate initData cryptographically (default: true)
    // Verification is mandatory; false throws during configuration
    validateInitData: true,

    // Allow auto-signin to create new users (default: true)
    // New users are created ONLY when BOTH autoCreateUser AND allowAutoSignin are true
    allowAutoSignin: true,

    // Map Telegram user data to your user model
    mapMiniAppDataToUser: (user) => ({
      name: user.username || user.first_name,
      image: user.photo_url,
    }),
  },
})
```

## Client Implementation

### 1. Load the Telegram WebApp SDK

Add this to your HTML `<head>`:

```html
<script src="https://telegram.org/js/telegram-web-app.js" async></script>
```

### 2. Create the Auth Client

```typescript
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

export const authClient = createAuthClient({
  baseURL: window.location.origin,
  fetchOptions: {
    credentials: "include",
  },
  plugins: [telegramClient()],
});
```

### 3. Auto Sign-in (The Whole Point)

The simplest path. User opens your Mini App, you sign them in. No clicks, no forms, no existential friction:

```typescript
const result = await authClient.autoSignInFromMiniApp();
// result.data?.user — your user, authenticated, ready to go
```

`autoSignInFromMiniApp()` prefers `window.Telegram.WebApp.initData` and falls back to the `tgWebAppData` launch parameter in `window.location.hash`. It sends the raw value to `/telegram/miniapp/signin`, where the server verifies it before creating a session. If neither source exists, it throws.

### 4. Manual Sign-in (More Control)

If you want to validate first or handle the flow yourself:

```typescript
const initData = window.Telegram.WebApp.initData;

// Optional: validate without signing in
const validation = await authClient.validateMiniApp(initData);
if (!validation.data?.valid) {
  throw new Error("Invalid Telegram launch data");
}

// Sign in
const result = await authClient.signInWithMiniApp(initData);
```

### Error handling

```ts
try {
  const result = await authClient.autoSignInFromMiniApp();
  if (result.error) {
    // Display the error message without logging initData or session tokens.
  } else {
    // Fetch your application data using the newly established session.
  }
} catch {
  // Browser/SDK launch data is unavailable, or the transport failed.
}
```

Validation-only calls do not grant application access and may accept a signed payload with no `user`. Sign-in requires a user. Signatures cannot be disabled; expired data should be refreshed rather than accepted indefinitely. See [security](security.md#hmac-verification-and-replay-limits).

## API Reference

### Server Endpoints

Both only exist when `miniApp.enabled` is `true`.

#### `POST /api/auth/telegram/miniapp/signin`

Signs in (or creates) a user from Mini App initData. Sets session cookie.

**Body:** `{ "initData": "user=%7B%22id%22...&auth_date=...&hash=..." }`

**Returns:** `{ user, session }`

**Errors:**
- `400` — Missing or malformed initData, no user in payload
- `401` — Cryptographic verification failed
- `403` — User not found and auto-creation disabled (`autoCreateUser` or `allowAutoSignin` is `false`)

#### `POST /api/auth/telegram/miniapp/validate`

Validates initData without creating a session. Useful for checking if the data is legit before doing something with it.

**Body:** `{ "initData": "..." }`

**Returns:** `{ valid: boolean, data: TelegramMiniAppData | null }`

### Client Methods

| Method | What it does |
|---|---|
| `authClient.signInWithMiniApp(initData)` | Sign in with raw initData string |
| `authClient.validateMiniApp(initData)` | Validate initData, get parsed data back |
| `authClient.autoSignInFromMiniApp()` | Grab initData from `window.Telegram.WebApp` and sign in automatically |

### Types

```typescript
interface TelegramMiniAppUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
  is_bot?: boolean;
  allows_write_to_pm?: boolean;
  photo_url?: string;
}

interface TelegramMiniAppData {
  user?: TelegramMiniAppUser;
  receiver?: TelegramMiniAppUser;
  chat?: TelegramMiniAppChat;
  chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
  chat_instance?: string;
  start_param?: string;
  can_send_after?: number;
  query_id?: string;
  auth_date: number;
  hash: string;
}

interface TelegramMiniAppChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  photo_url?: string;
}
```

## How Verification Works

Unlike the Login Widget (which uses `SHA256(botToken)` as the HMAC key), Mini Apps use a two-step HMAC:

1. `secret = HMAC-SHA256("WebAppData", botToken)`
2. `signature = HMAC-SHA256(secret, dataCheckString)`

Where `dataCheckString` is all initData params (minus `hash`), sorted alphabetically, joined with `\n`. Timestamp is checked against `maxAuthAge` (default 24h) to limit replay exposure; valid data can be reused within that window.

All of this runs on Web Crypto API (`crypto.subtle`) — no Node crypto dependency in the verifier. Runtime/adapter compatibility still needs validation.

## Troubleshooting

**"Not running in Telegram Mini App"** — You opened the page in a browser, not in Telegram. Open via `t.me/yourbot/yourapp`.

**"Telegram.WebApp is undefined"** — The SDK script hasn't loaded yet. Make sure `telegram-web-app.js` is in your `<head>`. If you're doing manual init, wait for it.

**"No initData available"** — The Mini App isn't properly configured in BotFather, or you're hitting the URL directly instead of through Telegram.

**"Invalid Mini App initData" (401)** — Cryptographic verification failed. Check your `TELEGRAM_BOT_TOKEN` is correct and matches the bot that owns the Mini App. Also check if `auth_date` is within `maxAuthAge`.

**"User not found and auto-create is disabled" (403)** — Either `autoCreateUser` or `miniApp.allowAutoSignin` is `false`, and this Telegram user doesn't have an existing account. Both must be `true` to create new users via Mini App.

## Resources

- [Telegram Mini Apps Docs](https://core.telegram.org/bots/webapps)
- [Telegram WebApp API](https://core.telegram.org/bots/webapps#initializing-mini-apps)
- [Better Auth](https://better-auth.com)
- [GitHub](https://github.com/dos41gw/better-auth-telegram)
