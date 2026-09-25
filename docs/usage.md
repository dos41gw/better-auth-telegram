# Usage

You've installed a Telegram auth plugin. Congratulations. Now make it do something.

## Client Setup

If you haven't set up the client yet, go read [Installation](./installation.md). We'll wait.

```ts
import { createAuthClient } from "better-auth/client";
import { telegramClient } from "better-auth-telegram/client";

const authClient = createAuthClient({
  baseURL: "http://localhost:3000",
  plugins: [telegramClient()],
});
```

## Sign In (Callback Mode)

The widget pops up, user clicks it, Telegram calls you back. The classic.

`initTelegramWidget` fetches the bot config from your server automatically -- you don't need to pass your bot username. One less thing to leak.

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function TelegramLogin() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-login", // container element ID
      { size: "large", cornerRadius: 20 },
      async (authData) => {
        const result = await authClient.signInWithTelegram(authData);
        if (result.error) {
          setError(result.error.message || "Authentication failed");
        } else {
          router.push("/dashboard");
        }
      }
    );
  }, [router]);

  return (
    <div>
      <div id="telegram-login" />
      {error && <p className="text-red-500">{error}</p>}
    </div>
  );
}
```

### Widget Options

All optional. All have sane defaults. Customize if you must.

```ts
authClient.initTelegramWidget("container-id", {
  size: "large",           // "large" | "medium" | "small" (default: "large")
  showUserPhoto: true,     // default: true
  cornerRadius: 20,        // default: 20
  requestAccess: false,    // request write access (default: false)
  lang: "en",              // language code
}, callback);
```

## Sign In (Redirect Mode)

Prefer redirects? Telegram sends the user to your URL with auth data as query params. Old school. Reliable.

### Step 1: Render the Widget

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect } from "react";

export function TelegramLoginRedirect() {
  useEffect(() => {
    authClient.initTelegramWidgetRedirect(
      "telegram-login",
      "/auth/telegram/callback",
      { size: "large" }
    );
  }, []);

  return <div id="telegram-login" />;
}
```

### Step 2: Handle the Callback

Create a page at your redirect URL. Parse the query params and call `signInWithTelegram`. Signed query strings are bearer credentials: avoid proxy/access/analytics logging, use a restrictive referrer policy, and remove the query from browser history after extracting it. Native OIDC is preferable for new browser integrations.

```tsx
// app/auth/telegram/callback/page.tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function TelegramCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const authData = {
      id: Number(searchParams.get("id")),
      first_name: searchParams.get("first_name")!,
      last_name: searchParams.get("last_name") || undefined,
      username: searchParams.get("username") || undefined,
      photo_url: searchParams.get("photo_url") || undefined,
      auth_date: Number(searchParams.get("auth_date")),
      hash: searchParams.get("hash")!,
    };

    window.history.replaceState(null, "", window.location.pathname);
    authClient.signInWithTelegram(authData).then((result) => {
      if (result.error) {
        setError(result.error.message || "Authentication failed");
      } else {
        router.push("/dashboard");
      }
    });
  }, [searchParams, router]);

  if (error) return <p>Auth failed: {error}</p>;
  return <p>Authenticating...</p>;
}
```

## Link Telegram Account

User already signed in? Let them bolt on Telegram. Same widget, different endpoint.

Requires `allowUserToLink:true`, core account linking enabled, and an authoritative session fresh enough for `session.freshAge`.

```tsx
"use client";

import { authClient } from "@/lib/auth-client";
import { useEffect, useState } from "react";

export function LinkTelegram() {
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    authClient.initTelegramWidget(
      "telegram-link",
      { size: "medium" },
      async (authData) => {
        const result = await authClient.linkTelegram(authData);
        setStatus(result.error ? result.error.message || "Link failed" : "Linked.");
      }
    );
  }, []);

  return (
    <div>
      <div id="telegram-link" />
      {status && <p>{status}</p>}
    </div>
  );
}
```

## Unlink Telegram Account

Call `unlinkTelegram` with a fresh authenticated session. The last account cannot be removed unless core `allowUnlinkingAll` is explicitly enabled.

```tsx
const result = await authClient.unlinkTelegram();

if (result.error) {
  console.error("Unlink failed:", result.error.message);
} else {
  console.log("Telegram unlinked. Freedom.");
}
```

## OIDC (OpenID Connect)

Standard OAuth 2.0 flow via `oauth.telegram.org`. No widgets, no callbacks, no injecting scripts into your DOM. The user clicks a button, gets redirected to Telegram, comes back authenticated. Like every other social login, except it's Telegram and it took them until Bot API 9.5 to ship it.

Enable on server:

```typescript
telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
    requestPhone: true,  // phone numbers -- the Login Widget's biggest regret
  },
});
```

Trigger from client:

```typescript
await authClient.signInWithTelegramOIDC({
  callbackURL: "/dashboard",
});
```

Better Auth handles PKCE, state and callback/session processing; the plugin verifies the ID token with jose. The `telegram-oidc` provider is injected automatically via the `init` hook — no manual provider registration.

### OIDC + Phone Numbers

`requestPhone:true` requests optional `phone_number` / `phone_number_verified` claims. It does not persist them. Better Auth filters protected `input:false` fields from ordinary OIDC profile mapping; see [profile mapping](configuration.md#profile-mapping) before designing trusted persistence. OIDC `sub` and numeric Telegram `id` are different identities.

### React Example

```tsx
"use client";

import { authClient } from "@/lib/auth-client";

export function TelegramOIDCLogin() {
  return (
    <button
      onClick={() =>
        authClient.signInWithTelegramOIDC({
          callbackURL: "/dashboard",
        })
      }
    >
      Sign in with Telegram
    </button>
  );
}
```

No widget scripts, no container elements, no cleanup on unmount. A button. That's it.

## Mini App

Running inside a Telegram Mini App? There's a whole separate flow for that. See [Mini Apps](./miniapps.md).

The short version:

```ts
// Auto-signin -- grabs initData from Telegram.WebApp automatically
const result = await authClient.autoSignInFromMiniApp();

// Manual -- pass initData yourself
const result = await authClient.signInWithMiniApp(
  window.Telegram.WebApp.initData
);

// Just validate, don't sign in
const result = await authClient.validateMiniApp(
  window.Telegram.WebApp.initData
);
```

## Fetch Options

API actions accept optional fetch options: the second argument for sign-in/link/validate/OIDC, and the first for unlink/config/automatic Mini App sign-in. DOM Widget helpers do not accept them. Headers, credentials, cache control -- whatever you need.

```ts
const result = await authClient.signInWithTelegram(authData, {
  headers: { "x-custom-header": "value" },
});

await authClient.unlinkTelegram({
  credentials: "include",
});
```

## Error Handling

API actions normally return `{ data, error }`; DOM helpers return `Promise<void>`. If `error` exists, something went wrong. The `error.message` tells you what. The `error.status` tells you how bad.

```ts
const result = await authClient.signInWithTelegram(authData);

if (result.error) {
  // 400 = bad data, 401 = auth failed, 409 = conflict
  console.error(result.error.status, result.error.message);
  return;
}

// result.data has your session
```

Handle `result.error` for ordinary HTTP failures. Transport failures, throwing fetch options and DOM/setup errors can reject and need try/catch.

## Vanilla JS

The following module example needs a bundler or an import map for bare package imports.

```html
<div id="telegram-login"></div>

<script type="module">
  import { createAuthClient } from "better-auth/client";
  import { telegramClient } from "better-auth-telegram/client";

  const authClient = createAuthClient({
    baseURL: window.location.origin,
    plugins: [telegramClient()],
  });

  authClient.initTelegramWidget(
    "telegram-login",
    { size: "large" },
    async (authData) => {
      const result = await authClient.signInWithTelegram(authData);
      if (result.error) {
        alert(result.error.message);
      } else {
        window.location.href = "/dashboard";
      }
    }
  );
</script>
```

## Next Steps

- [Configuration](./configuration.md) -- tweak every knob
- [Mini Apps](./miniapps.md) -- Telegram Mini App deep dive
- [API Reference](./api-reference.md) -- every endpoint, documented
- [Security](./security.md) -- how verification works
- [Troubleshooting](./troubleshooting.md) -- when things go sideways
