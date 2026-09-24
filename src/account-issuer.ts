import type { BetterAuthDBSchema } from "@better-auth/core/db";

/** Early Better Auth 1.7 releases require an issuer; later releases removed it. */
export function telegramAccountIssuer(tables: BetterAuthDBSchema) {
  return tables.account?.fields.issuer
    ? { issuer: "local:oauth:telegram" }
    : {};
}
