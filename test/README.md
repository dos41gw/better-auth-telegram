# Telegram authentication demo

Next.js demo for Widget, Mini App and OIDC flows using the local plugin and Better Auth 1.7.6. Requires Node 24+ or Bun with `node:sqlite` support. This is a development demo, not a production deployment template.

```sh
# Build the plugin from the repository root first
bun install --frozen-lockfile
bun run build
cd test
bun install --frozen-lockfile
cp .env.local.example .env.local
# Edit bot credentials, auth secret, URL and DATABASE_PATH before continuing
bun run db:migrate
bun run dev
```

`db:migrate` explicitly updates the SQLite file selected by `DATABASE_PATH` (default `telegram-demo.db` in the working directory). The app does not migrate automatically. Use only a local demo database. Existing Prisma demo databases are not migrated or deleted automatically; use a new local SQLite file for this demo version.

For Widget login, configure the bot domain through BotFather. For OIDC, register the exact origin and `/api/auth/callback/telegram-oidc` URL in BotFather's Web Login settings and configure its client ID/secret. For a Telegram Mini App, register a public HTTPS URL ending in `/miniapp`. An HTTPS tunnel can expose the demo; set `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS` and `NEXT_PUBLIC_APP_URL` accordingly.

Pages: `/widget`, `/miniapp`, `/oidc`, `/dashboard`. Verify login, session restoration, sign-out and account linking manually with your own Telegram account.

Validation: `bun run type-check` in this directory, and `bun run lint` / `bun run test:coverage` at the repository root. The demo uses root Biome instead of a separate ESLint stack. See the [security and migration guide](../docs/security-compatibility-audit.md) for MFA, captcha, replay and schema requirements.
