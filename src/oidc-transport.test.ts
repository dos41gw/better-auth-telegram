import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramOIDCProvider } from "./oidc";

afterEach(() => vi.restoreAllMocks());

const request = {
  code: "test-code",
  codeVerifier: "test-pkce",
  redirectURI: "https://example.com/api/auth/callback/telegram-oidc",
};

describe("OIDC custom transport", () => {
  it("uses the same transport for token exchange and JWKS, preserving Basic auth, PKCE, nonce, and token verification", async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = await exportJWK(keys.publicKey);
    const idToken = await new SignJWT({
      nonce: "test-nonce",
      name: "Telegram user",
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer("https://oauth.telegram.org")
      .setAudience("12345")
      .setSubject("test-subject")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(keys.privateKey);
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Direct connections are blocked"));
    const transport = vi.fn(async (input: string | URL, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      if (String(input).endsWith("/token")) {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          `Basic ${btoa("12345:test-secret")}`
        );
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("code_verifier")).toBe(request.codeVerifier);
        expect(body.get("redirect_uri")).toBe(request.redirectURI);
        return Response.json({
          access_token: "test-access",
          token_type: "Bearer",
          id_token: idToken,
        });
      }
      expect(String(input)).toBe(
        "https://oauth.telegram.org/.well-known/jwks.json"
      );
      return Response.json({
        keys: [{ ...jwk, kid: "test-key", alg: "RS256", use: "sig" }],
      });
    });
    const provider = createTelegramOIDCProvider("", {
      clientId: "12345",
      clientSecret: "test-secret",
      fetch: transport,
    });
    const tokens = await provider.validateAuthorizationCode(request);
    expect(tokens?.idToken).toBe(idToken);
    expect(
      (
        await provider.getUserInfo({
          ...tokens,
          expectedIdTokenNonce: "test-nonce",
        })
      )?.data?.sub
    ).toBe("test-subject");
    expect(
      await provider.getUserInfo({
        ...tokens,
        expectedIdTokenNonce: "wrong-nonce",
      })
    ).toBeNull();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it.each([302, 401, 500])(
    "rejects HTTP %s without leaking the token response",
    async (status) => {
      const provider = createTelegramOIDCProvider("", {
        clientId: "12345",
        clientSecret: "test-secret",
        fetch: async () => new Response("sensitive-response", { status }),
      });
      await expect(provider.validateAuthorizationCode(request)).rejects.toThrow(
        `Telegram OIDC token exchange failed (HTTP ${status})`
      );
    }
  );

  it("does not retry a failed custom transport through a direct connection", async () => {
    const globalFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("unexpected direct request"));
    const provider = createTelegramOIDCProvider("", {
      clientId: "12345",
      clientSecret: "test-secret",
      fetch: async () => {
        throw new Error("proxy unavailable");
      },
    });
    await expect(provider.validateAuthorizationCode(request)).rejects.toThrow(
      "proxy unavailable"
    );
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
