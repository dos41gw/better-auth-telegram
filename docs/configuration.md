# Configuration

These options belong to `telegram(...)`. Database adapters, cookies, rate limits, trusted origins and framework CORS belong to Better Auth or your hosting framework.

## Server options

| Option | Default | Behavior |
| --- | --- | --- |
| `botToken` | unset | Required by enabled HMAC flows; keep server-side |
| `botUsername` | unset | Required for rendering the Widget, without `@` |
| `loginWidget` | `true` | Registers Widget sign-in/link/unlink |
| `miniApp.enabled` | `false` | Registers Mini App sign-in/validation |
| `oidc.enabled` | `false` | Injects native `telegram-oidc` social provider |
| `autoCreateUser` | `true` | Allows HMAC signup; `false` also sets OIDC `disableSignUp` |
| `allowUserToLink` | `true` | Allows custom Widget linking, unless core account linking is disabled |
| `maxAuthAge` | `86400` | Positive finite HMAC payload lifetime in seconds, not one-time replay protection |
| `mapTelegramDataToUser` | name/image mapping | Synchronous mapping from verified Widget data |
| `miniApp.mapMiniAppDataToUser` | name/image mapping | Synchronous mapping from verified Mini App user |
| `miniApp.allowAutoSignin` | `true` | Allows Mini App signup only when `autoCreateUser` is also true; existing accounts can still sign in |
| `miniApp.validateInitData` | `true` | Deprecated switch; verification is mandatory and `false` throws |
| `testMode` | `false` | Returned as configuration metadata; warns when combined with OIDC. Current Widget helpers do not switch Telegram endpoints based on this flag |

Missing flow credentials log setup warnings and fail closed when the flow is used. Invalid `maxAuthAge`, `jwksFetchTimeoutMs`, or `validateInitData:false` throws during initialization.

## OIDC options

```ts
telegram({
  loginWidget: false,
  oidc: {
    enabled: true,
    clientId: process.env.TELEGRAM_OIDC_CLIENT_ID!,
    clientSecret: process.env.TELEGRAM_OIDC_CLIENT_SECRET!,
    disableIdTokenSignIn: true, // Example: allow redirect login only.
  },
});
```

| Option within `oidc` | Default | Behavior |
| --- | --- | --- |
| `clientId` | ID portion of bot token | Prefer explicit Web Login Client ID |
| `clientSecret` | bot token compatibility fallback | Configure the separate Web Login secret explicitly |
| `scopes` | `["openid", "profile"]` | Always includes `openid`; per-request scopes are added |
| `requestPhone` | `false` | Adds `phone`; makes consented claims available, does not persist them |
| `requestBotAccess` | `false` | Adds `telegram:bot_access` |
| `mapOIDCProfileToUser` | name/image mapping | Maps a verified copy of claims; cannot change account identity |
| `jwksFetchTimeoutMs` | `10000` | Positive finite JWKS network timeout in milliseconds |
| `disableSignUp` | core default (`false`) | Rejects new OIDC users; existing users may sign in |
| `disableImplicitSignUp` | core default (`false`) | New users must explicitly set client `requestSignUp:true` |
| `disableIdTokenSignIn` | core default (`false`) | Disables direct-token sign-in, keeps authorization-code login |
| `requireEmailVerification` | core default | Core email-verification policy; Telegram's placeholder email is unverified |
| `requireNonce` | `false` | Enables server-generated, state-bound nonce on redirect flow |

Telegram does not supply email; the plugin uses unverified `${sub}@telegram.oidc` placeholders for OIDC and `${numericId}@telegram.invalid` for HMAC signup. Enabling required email verification needs an application flow that establishes a real verified address. Do not treat placeholders as contact addresses or ownership proof.

For EdDSA tokens, use `scopes:["openid"]` without extra profile/phone/bot-access requests. ES256K is unsupported. Telegram OIDC has no documented test endpoint; `testMode` does not create one. See [security](security.md#oidc) for direct-token replay and nonce limitations.

## Profile mapping

```ts
telegram({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  botUsername: process.env.TELEGRAM_BOT_USERNAME!,
  mapTelegramDataToUser: (data) => ({
    name: data.username || data.first_name,
    image: data.photo_url,
  }),
});
```

HMAC defaults use first/last name and photo. New HMAC users always have `emailVerified:false`; mapped IDs cannot change their identity. Returning users retain their stored profile. Additional fields must exist in your configured schema. Mapping functions are synchronous and should not perform asynchronous persistence.

OIDC uses core profile-input rules. In Better Auth 1.7.6, `input:false` additional fields are filtered from provider-profile mappings too. In particular, returning `telegramPhoneNumber` from the mapper does not populate the plugin-owned protected field. Persist sensitive claims through an explicit trusted server-side flow; do not make identity/verification fields client-writable just to bypass filtering. OIDC-only deployments declare no extra Telegram columns.

## Linking and validation policy

Widget and Mini App share the numeric `telegram` account provider. OIDC uses `telegram-oidc` and its verified `sub`; the two are not automatically merged by email or metadata. Use explicit account linking while authenticated.

Custom linking requires `allowUserToLink` and core `account.accountLinking.enabled` not to be false. Native OIDC linking follows core social-account rules, not the Widget-only `allowUserToLink` switch. Link/unlink require a fresh authoritative session unless `session.freshAge` is zero. Last-account unlink needs core `allowUnlinkingAll`.

`user.validateUserInfo` receives custom methods `telegram-widget` / `telegram-miniapp` and actions `create-user`, `sign-in`, `link-account`. OIDC uses native `oauth`. Hooks and MFA/captcha policies must account for the actual methods and paths; see [integration limits](security.md#integration-limits).

## Client and Widget options

`telegramClient()` takes no options. Server settings come from the public `/telegram/config` endpoint, which never returns secrets.

Widget helpers accept `size` (`large`, `medium`, `small`; default `large`), `showUserPhoto` (true), `cornerRadius` (20), `requestAccess` (false), and optional `lang`. Call helpers in the browser after the container mounts.

API actions accept fetch options; DOM Widget helpers do not. `signInWithTelegramOIDC` additionally accepts native callback URLs, scopes, login hints, extra non-reserved authorization parameters, signup/redirect flags, additional state data and direct ID tokens. See the [API reference](api-reference.md#client-methods).
