# Better Auth Telegram documentation

Documentation for the [dos41gw fork](https://github.com/dos41gw/better-auth-telegram), version 4.x. It supports Better Auth `>=1.7.0 <1.8.0`; tests cover 1.7.0 and 1.7.6 on Node 24 and Bun. Other runtimes and database adapters require application-level validation.

Install from GitHub, not the upstream npm release:

```sh
bun add github:dos41gw/better-auth-telegram#main
```

Pin a commit for reproducibility. The repository includes compiled ESM/CJS exports and declarations, so consumers do not need its build toolchain.

## Guides

- [Installation](installation.md): credentials, server/client setup and schema migration.
- [Configuration](configuration.md): flow options, signup policies, OIDC and mappings.
- [Usage](usage.md): Widget, native OIDC and account-linking examples.
- [Mini Apps](miniapps.md): initData verification and automatic sign-in.
- [API reference](api-reference.md): client methods, routes, types and errors.
- [Security](security.md): guarantees, replay limits and Better Auth responsibilities.
- [Security and compatibility audit](security-compatibility-audit.md): 4.0 changes, migration and tested limits.
- [Troubleshooting](troubleshooting.md): cookies, credentials, expired data and schema errors.
- [Local demo](../test/README.md), [contributing](../CONTRIBUTING.md), [changelog](../CHANGELOG.md), [private vulnerability reporting](../SECURITY.md).

For browser-based OIDC, follow [Telegram Login](https://core.telegram.org/bots/telegram-login). For the legacy iframe Widget, see [Telegram Widget documentation](https://core.telegram.org/widgets/login). Mini Apps use a separate [initData protocol](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
