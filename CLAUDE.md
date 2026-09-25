# better-auth-telegram

The dos41gw fork targets Better Auth 1.7.x and is installed from GitHub. The upstream npm package does not include this fork's changes.

## Architecture

- `src/index.ts` → `better-auth-telegram`: server plugin, conditional schema/endpoints, OIDC injection.
- `src/client.ts` → `better-auth-telegram/client`: Widget DOM helpers, Mini App/OIDC actions, session-store notifications.
- `src/authentication.ts`: shared HMAC provisioning, validation, authoritative/fresh sessions.
- `src/widget-endpoints.ts`, `src/miniapp-endpoints.ts`, `src/config-endpoint.ts`: HTTP endpoints.
- `src/verify.ts`: Widget and Mini App Web Crypto HMAC verification, timestamps and structural validation.
- `src/oidc.ts`: native social provider; verified stable `sub`, jose remote JWKS caching and claim checks.
- `src/plugin-config.ts`, `src/schema.ts`, `src/constants.ts`, `src/types.ts`: config, schema, errors and public types.

Widget registers `/telegram/signin`, `/telegram/link`, `/telegram/unlink`; Mini App optionally registers `/telegram/miniapp/signin` and `/telegram/miniapp/validate`. `/telegram/config` is always present. Better Auth prefixes the auth base path. OIDC uses native `/sign-in/social` and `/callback/telegram-oidc` routes.

Telegram fields are declared only if Widget or Mini App is enabled. OIDC-only configuration requires both to be disabled. User/account Telegram IDs are nullable and unique, with `input:false`; deployed databases require an explicit migration.

## Tooling

Use Bun and the checked-in lockfiles. Node 24.11+ builds the package; runtime Node requirement is 24+. Biome handles lint/format directly. tsdown emits ESM/CJS, declarations and maps. TypeScript 7, Vitest 5 and happy-dom are development dependencies. jose is the sole direct runtime dependency; better-auth and @better-auth/core are peers.

```sh
bun run type-check
bun run test
bun --bun run test
bun run test:coverage
bun run lint
bun run lint:fix
bun run build
```

Tests live beside source. HTTP security tests use real Better Auth and in-memory SQLite; browser tests use happy-dom. Coverage thresholds remain 90% lines/statements/branches and 80% functions. `dist/` is committed for Git consumers; rebuild it after source/declaration changes. No lint-staged, Ultracite or Vitest UI setup is installed.

## Review constraints

- Use Better Auth internal adapter APIs for provisioning hooks and transactions; use its cookies and output parsers.
- Sensitive custom mutations use `telegramSessionMiddleware`, which ignores cookie cache and respects freshness settings. Use the existing Better Auth CSRF middleware; do not introduce a parallel auth stack.
- HMAC verification cannot be disabled. Timestamp expiry limits replay exposure but is not one-time replay protection.
- Rate-limit enforcement belongs to Better Auth and depends on app settings and storage.
- Never infer ownership from email or denormalized metadata; never remap OIDC account identity.
- Keep secrets and signed payloads out of responses/logs. `APIError` is structured error handling, not automatic redaction.
- Consult [security boundaries](docs/security.md) before claiming MFA, captcha, arbitrary adapter/runtime, or anonymous-upgrade compatibility.
- Demo migrations are explicit CLI actions. Do not run them against production or during app import/build.
