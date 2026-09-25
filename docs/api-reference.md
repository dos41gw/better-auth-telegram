# API reference

Reference for the 4.x fork. Server exports are `telegram`, `createTelegramOIDCProvider`, and the public types in [src/index.ts](../src/index.ts). Client exports are `telegramClient` (also the default export) and `TelegramWidgetOptions`. Internal HMAC helpers are not exported package APIs.

## Server plugin

`telegram(options)` returns a Better Auth plugin with ID `telegram`. See [configuration](configuration.md) for all options and defaults. Widget routes are present unless `loginWidget:false`; Mini App routes require `miniApp.enabled:true`. The config endpoint is always registered. OIDC injects a native social provider when enabled.

`createTelegramOIDCProvider(botToken, options?)` constructs the same provider directly; registering it in Better Auth and supplying credentials remains the caller's responsibility. Normal integrations should use `telegram(...)`.

## Client methods

API actions return Better Fetch results: `{ data, error }` by default. The payload shapes below refer to **`result.data`**, not the top-level result. With throwing fetch options or transport failures, calls can reject. DOM helpers return `Promise<void>` and may throw setup errors.

| Method | Arguments | Success payload / effect |
| --- | --- | --- |
| `signInWithTelegram` | `TelegramAuthData`, `fetchOptions?` | `{ user, session }`; sets session cookie |
| `linkTelegram` | `TelegramAuthData`, `fetchOptions?` | `{ success: true, message }` |
| `unlinkTelegram` | `fetchOptions?` | `{ success: true, message }` |
| `getTelegramConfig` | `fetchOptions?` | Bot username and feature flags |
| `initTelegramWidget` | `containerId`, `options`, `onAuth` | Renders callback Widget; no fetch-options argument |
| `initTelegramWidgetRedirect` | `containerId`, `redirectUrl`, `options?` | Renders legacy redirect Widget; caller implements callback page |
| `signInWithMiniApp` | raw `initData` string, `fetchOptions?` | `{ user, session }` |
| `validateMiniApp` | raw `initData` string, `fetchOptions?` | `{ valid, data: TelegramMiniAppData \| null }`; no session |
| `autoSignInFromMiniApp` | `fetchOptions?` | Uses SDK initData, then URL-fragment fallback; signs in |
| `signInWithTelegramOIDC` | `options?`, `fetchOptions?` | Native social response; redirect login or direct-token result |

Successful custom session mutations notify Better Auth's session store. Failed HTTP requests do not. DOM helpers require a browser and an existing container; `autoSignInFromMiniApp` throws if neither initData source is available.

### OIDC request options

`signInWithTelegramOIDC` fixes `provider:"telegram-oidc"` and forwards:

- `callbackURL`, `errorCallbackURL`, `newUserCallbackURL`.
- `disableRedirect`, `requestSignUp`, `scopes`, `loginHint`.
- `additionalParams: Record<string,string>`: non-reserved authorization parameters; core rejects reserved OAuth/PKCE/state keys.
- `additionalData: Record<string,unknown>`: state-associated data; do not put secrets or signed login payloads here.
- `idToken: { token, nonce?, accessToken?, refreshToken?, expiresAt? }`: native direct-token request shape. Passing a refresh token does not add a Telegram refresh-token grant or guarantee core persists every supplied field.

Redirect initiation returns a native `{ url, redirect }` payload. With default fetch plugins, `redirect:true` navigates the browser. Direct ID-token sign-in returns the native social-login response, not the custom HMAC `{ user, session }` shape. See [nonce/replay limits](security.md#oidc).

### Widget options

`size?: "large" | "medium" | "small"` (default large), `showUserPhoto?: boolean` (true), `cornerRadius?: number` (20), `requestAccess?: boolean` (false), `lang?: string` (unset).

## Types

The authoritative type definitions are in [src/types.ts](../src/types.ts) and [src/client.ts](../src/client.ts).

```ts
interface TelegramAuthData {
  id: number;
  first_name: string;
  auth_date: number;
  hash: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}
```

IDs and timestamps must be positive safe integers. `hash` is a SHA-256 HMAC encoded as 64 hexadecimal characters. An invalid hash is an authentication failure, not necessarily a body-shape error.

`TelegramMiniAppData` contains `auth_date`, `hash`, and optional `user`, `receiver`, `chat`, `query_id`, `start_param`, `chat_type`, `chat_instance`, `can_send_after`. `TelegramMiniAppUser` requires `id` and `first_name`; optional fields include name/photo/username, language, bot/premium status and message permission. A signed payload without a user may validate but cannot sign in.

`TelegramOIDCClaims` requires verified `iss`, `aud`, `sub`, `iat`, `exp`. Profile/phone claims are optional. `sub` is the OIDC account identifier and must not be assumed to equal numeric `id`.

Also exported: `TelegramPluginOptions`, `TelegramPluginConfig`, `TelegramOIDCOptions`, `TelegramMiniAppChat`, and `TelegramAccountRecord`. Not every internal interface in `src/types.ts` is re-exported publicly.

## Endpoints

Paths below are relative to Better Auth's base path, usually `/api/auth`.

| Method / path | Body | Authentication / success |
| --- | --- | --- |
| POST `/telegram/signin` | `TelegramAuthData` | Signed Widget data; `{ user, session }` |
| POST `/telegram/link` | `TelegramAuthData` | Signed data plus authoritative fresh session; `{ success:true, message }` |
| POST `/telegram/unlink` | empty | Authoritative fresh session; `{ success:true, message }` |
| GET `/telegram/config` | none | Public; config object below |
| POST `/telegram/miniapp/signin` | `{ initData:string }` | Signed initData containing a user; `{ user, session }` |
| POST `/telegram/miniapp/validate` | `{ initData:string }` | `{ valid:boolean, data:TelegramMiniAppData \| null }` |

The config payload is:

```json
{
  "botUsername": "example_bot",
  "loginWidgetEnabled": true,
  "miniAppEnabled": false,
  "oidcEnabled": false,
  "testMode": false
}
```

Validation does not create a session or grant resource access. Invalid signatures, timestamps or parsed structures produce `{ valid:false, data:null }` on the validation-only endpoint. Missing/non-string initData is a 400 error. Missing runtime bot credentials is a 500 error.

OIDC uses core `POST /sign-in/social` with `provider:"telegram-oidc"`, and `GET /callback/telegram-oidc`. Better Auth manages callback state, session creation, signup and social-account-linking policies; the provider verifies the ID token before profile mapping.

## Errors

The plugin's `$ERROR_CODES` contains `{ code, message }` definitions; compare the string `error.code` to the relevant `.code`. Core, hooks and the shared authentication helper may also return codes not included in this object.

| Status | Code / situation |
| --- | --- |
| 400 | `INVALID_AUTH_DATA`, `INIT_DATA_REQUIRED`, `INVALID_MINI_APP_DATA_STRUCTURE`, `NO_USER_IN_INIT_DATA` |
| 400 | `FAILED_TO_UNLINK_LAST_ACCOUNT` unless core `allowUnlinkingAll` is enabled |
| 401 | `INVALID_AUTHENTICATION`, `INVALID_MINI_APP_INIT_DATA`, `NOT_AUTHENTICATED` |
| 403 | `USER_CREATION_DISABLED` for new Widget/Mini App accounts when signup is disabled |
| 403 | `LINKING_DISABLED` when plugin or core disables custom linking |
| 403 | `SESSION_NOT_FRESH`; core origin/CSRF errors; validation/hook/session vetoes |
| 404 | `NOT_LINKED`; disabled routes; native provider unavailable |
| 409 | `TELEGRAM_ALREADY_LINKED_OTHER`, `TELEGRAM_ALREADY_LINKED_SELF`, `TELEGRAM_EXPLICIT_LINK_REQUIRED` |
| 429 | Better Auth HTTP rate limit exceeded |
| 500 | `BOT_TOKEN_REQUIRED` on an enabled HMAC route without credentials |

`INVALID_AUTHENTICATION` can also be returned with 403 after a hook/provisioning veto. `BOT_USERNAME_REQUIRED` is used by Widget setup on the client. `MINI_APP_AUTO_SIGNIN_DISABLED` remains in the exported constants for compatibility; current Mini App signup denial uses `USER_CREATION_DISABLED` (403).

Successful link/unlink messages are `Telegram account linked successfully` and `Telegram account unlinked successfully`.

## Rate limits and schema extensions

The plugin supplies 10/60s for Widget and Mini App sign-in, 5/60s for link/unlink, and 20/60s for Mini App validation. Enforcement, overrides, storage and direct server-call exemptions belong to [Better Auth](security.md#rate-limiting). Config and native social routes have no Telegram-specific rate rule.

See [schema additions](installation.md#database-schema): both Telegram ID columns are unique/nullable, and **all five plugin fields have `input:false`**, including account fields. They are conditional on Widget or Mini App being enabled. Required core fields and version-specific migrations still apply.

## Internal verification

HMAC helpers in `src/verify.ts` are internal. Widget shape validation precedes HMAC; Mini App raw checks/HMAC precede JSON/user validation. Both enforce the timestamp window; Mini Apps additionally reject duplicate query keys and oversized input. `crypto.subtle.verify` compares signatures. See [security details](security.md#hmac-verification-and-replay-limits) for what this does and does not prevent.
