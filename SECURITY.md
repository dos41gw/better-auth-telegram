# Security Policy

This policy applies to the [dos41gw fork](https://github.com/dos41gw/better-auth-telegram), not the upstream npm release.

## Supported Versions

| Version | Status |
| --- | --- |
| 4.x on Better Auth `>=1.7.0 <1.8.0` | Current maintained fork line |
| 3.x and earlier | Upgrade using the migration guide |

Use the latest patched Better Auth version within the supported range. The fork is installed from GitHub; installing `better-auth-telegram` from npm alone does not install this fork. See [installation](docs/installation.md) and the [4.0 migration guide](docs/security-compatibility-audit.md#migration-from-3x).

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/dos41gw/better-auth-telegram/security/advisories/new). It is enabled for this fork. Do not put exploit details, credentials, or affected users' data in a public issue.

Include the affected commit and Better Auth version, a description, minimal reproduction, expected/actual behavior, potential impact, and a suggested fix if available. Use synthetic credentials and accounts. State whether you would like public credit.

Response and patch times depend on maintainer availability; this fork does not promise a fixed response SLA. The upstream author's email address is not a reporting address for this fork.

## Security Guarantees and Limits

- Widget and Mini App signatures are verified with Web Crypto HMAC-SHA-256, using their distinct Telegram key derivations. Mini App verification cannot be disabled.
- `auth_date` must be a positive safe integer within `maxAuthAge` (default 24 hours), with at most 30 seconds of future clock skew. This limits exposure; **it does not prevent replay within that window**. Neither the plugin nor Better Auth deduplicates these Telegram HMAC payloads.
- OIDC tokens are verified with `jose` on both the code-callback and direct-ID-token paths. Verification checks the allowed algorithm, signature, issuer, audience, required claims, expiry, issued-at time, and an expected nonce when supplied. JWKS requests are cached and time-bounded.
- Better Auth owns OAuth state/PKCE, session cookies, HTTP rate-limit enforcement, and core origin checks. The plugin uses its APIs and first-login CSRF middleware for custom HMAC sign-in routes. These protections depend on application configuration.
- Link/unlink require an authoritative session and honor `session.freshAge`; setting it to zero disables the freshness requirement. Linking respects the core account-linking setting; unlinking the last account requires `allowUnlinkingAll`.
- Telegram schema fields use `input: false`; Better Auth's parsers enforce that restriction. Database uniqueness requires the actual schema migration. Direct database writes or application-defined endpoints remain the application's responsibility.
- User/session responses use Better Auth's output parsers. `APIError` standardizes errors, but is not itself a guarantee that custom hooks, logging, or application code cannot expose data.
- The plugin keeps bot tokens and OIDC client secrets out of its public configuration endpoint. Signed login payloads, ID tokens, and session tokens are also credentials: do not log them.

See [security details](docs/security.md) for rate-limit prerequisites, nonce/replay limitations, MFA/captcha integration, and the boundary between plugin and Better Auth responsibilities. The [audit report](docs/security-compatibility-audit.md) records tested versions and remaining limitations.
