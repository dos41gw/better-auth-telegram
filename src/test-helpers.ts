import { createHash, createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { afterEach } from "vitest";
import { telegram } from "./index";
import type { TelegramPluginOptions } from "./types";

export const origin = "http://localhost:3000";
export const botToken = "123456:test-bot-token";
const databases: DatabaseSync[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

export async function setup(
  plugin: Partial<TelegramPluginOptions> = {},
  options: BetterAuthOptions = {}
) {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  const config = {
    baseURL: origin,
    secret: "a-test-secret-with-more-than-32-characters",
    database,
    logger: { disabled: true },
    advanced: { disableCSRFCheck: false, disableOriginCheck: false },
    emailAndPassword: { enabled: true },
    ...options,
    plugins: [
      telegram({
        botToken,
        botUsername: "test_bot",
        miniApp: { enabled: true },
        ...plugin,
      }),
      ...(options.plugins || []),
    ],
  };
  await (await getMigrations(config)).runMigrations();
  const auth = betterAuth(config);
  const request = (
    path: string,
    body?: unknown,
    cookie?: string,
    headers: Record<string, string> = {}
  ) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    );
  const rows = (table: "user" | "account" | "session") =>
    database.prepare(`SELECT * FROM "${table}"`).all() as Record<string, any>[];
  const credentialSession = async (email = "existing@example.com") =>
    request("/sign-up/email", {
      name: "Existing",
      email,
      password: "test-password-strong",
    });
  return { auth, database, rows, request, credentialSession };
}
export function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
export function widgetData(id = 111, overrides: Record<string, unknown> = {}) {
  const data = {
    id,
    first_name: "Alice",
    auth_date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  const check = Object.entries(data)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return {
    ...data,
    hash: createHmac("sha256", createHash("sha256").update(botToken).digest())
      .update(check)
      .digest("hex"),
  };
}
export function miniAppData(id = 111, overrides: Record<string, string> = {}) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Alice" }),
    ...overrides,
  });
  const check = [...params]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  params.set(
    "hash",
    createHmac(
      "sha256",
      createHmac("sha256", "WebAppData").update(botToken).digest()
    )
      .update(check)
      .digest("hex")
  );
  return { initData: params.toString() };
}
