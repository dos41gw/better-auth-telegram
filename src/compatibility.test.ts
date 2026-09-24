/** @vitest-environment node */

import { createHash, createHmac } from "node:crypto";
import { getAuthTables } from "@better-auth/core/db";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import { telegram } from "./index";
import type { TelegramOIDCOptions } from "./types";

const origin = "http://localhost:3000";
const botToken = "123456:integration-test-bot-token";
const clientId = "123456";
let keyPair: Awaited<ReturnType<typeof generateKeyPair>>;
let publicKey: Awaited<ReturnType<typeof exportJWK>>;
let exchangedToken: string;
let jwksStatus = 200;

beforeAll(async () => {
  keyPair = await generateKeyPair("RS256");
  publicKey = {
    ...(await exportJWK(keyPair.publicKey)),
    kid: "integration-key",
    alg: "RS256",
    use: "sig",
  };
});
beforeEach(async () => {
  jwksStatus = 200;
  exchangedToken = await signToken();
  // Only Telegram's external transport is replaced; all Better Auth code is real.
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === TELEGRAM_OIDC_JWKS_URI) {
      return Promise.resolve(
        Response.json({ keys: [publicKey] }, { status: jwksStatus })
      );
    }
    if (url === TELEGRAM_OIDC_TOKEN_ENDPOINT) {
      return Promise.resolve(
        Response.json({
          access_token: "test-access-token",
          token_type: "Bearer",
          id_token: exchangedToken,
        })
      );
    }
    throw new Error(`Unexpected external request: ${url}`);
  });
});
afterEach(() => vi.restoreAllMocks());

function signToken(
  claims: Record<string, unknown> = {},
  signingKey = keyPair.privateKey
) {
  return new SignJWT({
    sub: "existing-oidc-subject",
    name: "Telegram User",
    ...claims,
  })
    .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
    .setIssuer(TELEGRAM_OIDC_ISSUER)
    .setAudience(clientId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingKey);
}
function setup(oidc: TelegramOIDCOptions = {}) {
  const db: Record<string, any[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: origin,
    secret: "integration-test-secret-at-least-32-characters",
    database: memoryAdapter(db),
    logger: { disabled: true },
    plugins: [
      telegram({
        botToken,
        botUsername: "integration_bot",
        miniApp: { enabled: true, allowAutoSignin: true },
        oidc: {
          enabled: true,
          clientId,
          clientSecret: "oidc-test-secret",
          ...oidc,
        },
      }),
    ],
  });
  const request = (path: string, body?: unknown, cookie?: string) =>
    auth.handler(
      new Request(`${origin}/api/auth${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "content-type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    );
  return { db, request };
}
function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function callback(request: ReturnType<typeof setup>["request"]) {
  const start = await request("/sign-in/social", {
    provider: "telegram-oidc",
    callbackURL: "/done",
  });
  expect(start.status).toBe(200);
  const url = new URL((await start.json()).url);
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  return request(
    `/callback/telegram-oidc?code=test-code&state=${encodeURIComponent(url.searchParams.get("state")!)}`,
    undefined,
    cookies(start)
  );
}
function widgetData(id: number) {
  const data = {
    id,
    first_name: "Widget User",
    auth_date: Math.floor(Date.now() / 1000),
  };
  const check = Object.entries(data)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  return {
    ...data,
    hash: createHmac("sha256", createHash("sha256").update(botToken).digest())
      .update(check)
      .digest("hex"),
  };
}
function miniAppData(id: number) {
  const params = new URLSearchParams({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id, first_name: "Mini User" }),
  });
  const check = [...params]
    .sort(([a], [b]) => a.localeCompare(b))
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

describe("Better Auth 1.7 HTTP integration", () => {
  it("completes the OIDC code callback and reuses an existing subject after upgrade", async () => {
    const { db, request } = setup();
    const now = new Date();
    db.user!.push({
      id: "existing-user",
      name: "Existing",
      email: "existing-oidc-subject@telegram.oidc",
      emailVerified: false,
      createdAt: now,
      updatedAt: now,
    });
    db.account!.push({
      id: "existing-account",
      // Mirrors Better Auth's required backfill on issuer-based 1.7 versions.
      ...(getAuthTables({}).account?.fields.issuer
        ? { issuer: "local:oauth:telegram-oidc" }
        : {}),
      userId: "existing-user",
      providerId: "telegram-oidc",
      accountId: "existing-oidc-subject",
      createdAt: now,
      updatedAt: now,
    });
    const response = await callback(request);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/done");
    const session = await request("/get-session", undefined, cookies(response));
    expect((await session.json()).user.id).toBe("existing-user");
    expect(db.user).toHaveLength(1);
    expect(db.account).toHaveLength(1);
  });

  it("creates an OIDC account from verified sub, independent of profile mapping", async () => {
    const { db, request } = setup({
      mapOIDCProfileToUser: (claims) => {
        claims.sub = "mapper-mutated-subject";
        return { name: "Mapped", email: "mapped@example.com" };
      },
    });
    const response = await callback(request);
    expect(response.headers.get("location")).toBe("/done");
    expect(db.account![0].accountId).toBe("existing-oidc-subject");
    expect(db.user![0].name).toBe("Mapped");
  });

  it.each([
    "signature",
    "issuer",
    "audience",
    "expiry",
    "missing-sub",
    "jwks",
  ])("rejects invalid %s before profile mapping or database writes", async (failure) => {
    const mapper = vi.fn(() => ({ name: "Never mapped" }));
    const { db, request } = setup({ mapOIDCProfileToUser: mapper });
    if (failure === "signature") {
      exchangedToken = await signToken(
        {},
        (await generateKeyPair("RS256")).privateKey
      );
    }
    if (failure === "issuer") {
      exchangedToken = await new SignJWT({ sub: "bad" })
        .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
        .setIssuer("https://wrong.example")
        .setAudience(clientId)
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair.privateKey);
    }
    if (failure === "audience") {
      exchangedToken = await new SignJWT({ sub: "bad" })
        .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience("wrong")
        .setIssuedAt()
        .setExpirationTime("1h")
        .sign(keyPair.privateKey);
    }
    if (failure === "expiry") {
      exchangedToken = await new SignJWT({ sub: "bad" })
        .setProtectedHeader({ alg: "RS256", kid: "integration-key" })
        .setIssuer(TELEGRAM_OIDC_ISSUER)
        .setAudience(clientId)
        .setIssuedAt()
        .setExpirationTime(1)
        .sign(keyPair.privateKey);
    }
    if (failure === "missing-sub") {
      exchangedToken = await signToken({ sub: undefined });
    }
    if (failure === "jwks") {
      jwksStatus = 503;
    }
    const response = await callback(request);
    expect(response.headers.get("location")).toContain(
      "error=unable_to_get_user_info"
    );
    expect(mapper).not.toHaveBeenCalled();
    expect(db.user).toHaveLength(0);
    expect(db.account).toHaveLength(0);
    expect(db.session).toHaveLength(0);
  });

  it("supports direct ID-token sign-in and rejects a mismatched nonce", async () => {
    const { db, request } = setup();
    const token = await signToken({ nonce: "expected-nonce" });
    const denied = await request("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "wrong-nonce" },
    });
    expect(denied.status).toBe(401);
    expect(db.user).toHaveLength(0);
    const accepted = await request("/sign-in/social", {
      provider: "telegram-oidc",
      idToken: { token, nonce: "expected-nonce" },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.headers.has("set-cookie")).toBe(true);
    expect(db.account![0].accountId).toBe("existing-oidc-subject");
  });

  it("signs in Widget and Mini App users and restores their sessions", async () => {
    const { db, request } = setup();
    for (const [path, body] of [
      ["/telegram/signin", widgetData(111)],
      ["/telegram/miniapp/signin", miniAppData(222)],
    ] as const) {
      const response = await request(path, body);
      expect(response.status).toBe(200);
      const session = await request(
        "/get-session",
        undefined,
        cookies(response)
      );
      expect((await session.json()).user.id).toBeTruthy();
      expect((await request(path, body)).status).toBe(200);
    }
    expect(db.user).toHaveLength(2);
    expect(db.account).toHaveLength(2);
    if (getAuthTables({}).account?.fields.issuer) {
      expect(db.account!.map((account) => account.issuer)).toEqual([
        "local:oauth:telegram",
        "local:oauth:telegram",
      ]);
    }
  });

  it("links and unlinks a Widget account from an authenticated OIDC user", async () => {
    const { db, request } = setup();
    const session = await callback(request);
    const cookie = cookies(session);
    expect(
      (await request("/telegram/link", widgetData(333), cookie)).status
    ).toBe(200);
    expect(db.account).toHaveLength(2);
    expect((await request("/telegram/unlink", {}, cookie)).status).toBe(200);
    expect(db.account).toHaveLength(1);
    expect(db.account![0].providerId).toBe("telegram-oidc");
  });
});
