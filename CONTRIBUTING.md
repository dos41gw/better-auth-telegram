# Contributing

This repository is the [dos41gw fork](https://github.com/dos41gw/better-auth-telegram). Upstream history and attribution are retained; changes here target Better Auth 1.7.x.

## Development setup

Use Node 24.11+ for the current build toolchain (`.nvmrc` selects Node 24) and Bun 1.4.2, matching CI. Package runtime support starts at Node 24; build-tool requirements can be stricter.

```sh
git clone https://github.com/dos41gw/better-auth-telegram.git
cd better-auth-telegram
bun install --frozen-lockfile
bun run build
```

## Commands

```sh
bun run dev             # tsdown watch mode; stop it when finished
bun run type-check      # TypeScript
bun run test            # Vitest under Node
bun --bun run test      # Vitest under Bun
bun run test:watch      # interactive watch mode
bun run test:coverage   # v8 coverage
bun run lint            # Biome
bun run lint:fix        # Biome with fixes
bun run build           # ESM, CJS, declarations and source maps
```

Run one suite with `bun run test src/verify.test.ts`. There is no Vitest UI script, lint-staged hook, Ultracite wrapper, or tsup build.

## Structure and tests

- `src/index.ts`: server plugin registration, conditional schema/endpoints and native OIDC provider injection.
- `src/authentication.ts`: shared HMAC provisioning and authoritative session middleware.
- `src/widget-endpoints.ts`, `src/miniapp-endpoints.ts`: custom HTTP routes.
- `src/verify.ts`: Web Crypto HMAC verification; `src/oidc.ts`: jose/JWKS token verification.
- `src/client.ts`: Widget helpers, Mini App/OIDC actions and session notifications.
- Co-located `*.test.ts`: browser unit tests plus real Better Auth HTTP/SQLite integration. Only test helpers use Node crypto to sign fixtures.
- `test/`: standalone Next.js/SQLite demo; follow its [README](test/README.md).

Coverage thresholds are 90% statements/lines/branches and 80% functions. CI covers Better Auth 1.7.0 and 1.7.6, Bun, type checking, lint, the demo type check, and reproducible committed build output. In-memory SQLite tests do not modify a production database.

## Changes and pull requests

Keep changes focused. Use Better Auth APIs for sessions, hooks, errors, origin checks and rate limiting instead of duplicating them. Preserve account identities, validate signatures before trusting profiles, and keep credentials out of logs. Add meaningful regressions for behavioral/security changes; documentation edits do not need artificial tests.

Run relevant checks, update documentation and [CHANGELOG.md](CHANGELOG.md), rebuild and commit `dist/` when source or declarations change. Git installs depend on these committed artifacts. Open a PR against this fork's `main` describing the behavior and validation performed. Ordinary branch pushes do not publish to npm; the release workflow packages GitHub release assets when a version tag is pushed.

Use [issues](https://github.com/dos41gw/better-auth-telegram/issues) for ordinary bugs with redacted reproductions. Follow [SECURITY.md](SECURITY.md) for vulnerabilities and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for participation rules.
