import type { OAuthProvider } from "@better-auth/core/oauth2";
import {
  createAuthorizationURL,
  validateAuthorizationCode,
} from "@better-auth/core/oauth2";
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  jwtVerify,
} from "jose";
import {
  TELEGRAM_OIDC_AUTH_ENDPOINT,
  TELEGRAM_OIDC_ISSUER,
  TELEGRAM_OIDC_JWKS_URI,
  TELEGRAM_OIDC_PROVIDER_ID,
  TELEGRAM_OIDC_TOKEN_ENDPOINT,
} from "./constants";
import type { TelegramOIDCClaims, TelegramOIDCOptions } from "./types";

/**
 * Fetches a public key from Telegram's JWKS endpoint by key ID
 */
const SUPPORTED_SIGNING_ALGORITHMS = new Set(["RS256", "ES256", "EdDSA"]);

/**
 * Builds the scopes array from OIDC options
 */
function buildScopes(options: TelegramOIDCOptions): string[] {
  const scopes = new Set<string>(["openid"]);

  if (options.scopes) {
    for (const scope of options.scopes) {
      scopes.add(scope);
    }
  } else {
    scopes.add("profile");
  }

  if (options.requestPhone) {
    scopes.add("phone");
  }

  if (options.requestBotAccess) {
    scopes.add("telegram:bot_access");
  }

  return Array.from(scopes);
}

/**
 * Creates a Telegram OIDC provider for better-auth's social login system.
 *
 * Follows the same pattern as Google's provider in better-auth core.
 * Uses standard OAuth 2.0 Authorization Code flow with PKCE
 * via oauth.telegram.org.
 *
 * @param botToken - Bot token from @BotFather (bot ID extracted as client_id)
 * @param options - OIDC configuration options
 */
export function createTelegramOIDCProvider(
  botToken: string,
  options: TelegramOIDCOptions = {}
): OAuthProvider<TelegramOIDCClaims> {
  const botId = botToken.split(":")[0]!;

  // Client ID and secret come from BotFather's Web Login settings (Bot Settings > Web Login).
  // Falls back to bot token values for backward compatibility.
  const clientId = options.clientId || botId;
  const clientSecret = options.clientSecret || botToken;
  if (!(options.clientSecret || botToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login."
    );
  } else if (!options.clientSecret) {
    console.warn(
      "[better-auth-telegram] OIDC: no clientSecret provided. Using bot token as fallback.",
      "For OIDC to work, configure Web Login in @BotFather (Bot Settings > Web Login)",
      "and pass the Client Secret via oidc.clientSecret."
    );
  }

  const jwksFetchTimeoutMs = options.jwksFetchTimeoutMs ?? 10_000;
  if (!Number.isFinite(jwksFetchTimeoutMs) || jwksFetchTimeoutMs <= 0) {
    throw new Error(
      "[better-auth-telegram] jwksFetchTimeoutMs must be a positive finite number."
    );
  }

  // jose caches and coalesces key fetches, bounds their duration, and handles rotation.
  const jwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC_JWKS_URI), {
    timeoutDuration: jwksFetchTimeoutMs,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
    [customFetch]: (url, init) => fetch(url, { ...init, redirect: "error" }),
  });

  const providerOptions = {
    clientId,
    clientSecret,
    ...(options.disableSignUp !== undefined
      ? { disableSignUp: options.disableSignUp }
      : {}),
    ...(options.disableImplicitSignUp !== undefined
      ? { disableImplicitSignUp: options.disableImplicitSignUp }
      : {}),
    ...(options.disableIdTokenSignIn !== undefined
      ? { disableIdTokenSignIn: options.disableIdTokenSignIn }
      : {}),
    ...(options.requireEmailVerification !== undefined
      ? { requireEmailVerification: options.requireEmailVerification }
      : {}),
  };

  const requireOIDCCredentials = () => {
    if (!clientId) {
      throw new Error(
        "[better-auth-telegram] OIDC: clientId is required before starting an OIDC login."
      );
    }
    if (!clientSecret) {
      throw new Error(
        "[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login."
      );
    }
  };

  const verifyToken = async (
    token: string,
    nonce?: string
  ): Promise<TelegramOIDCClaims | null> => {
    try {
      const { kid, alg } = decodeProtectedHeader(token);
      if (!(kid && alg)) {
        return null;
      }
      if (!clientId) {
        return null;
      }
      if (!SUPPORTED_SIGNING_ALGORITHMS.has(alg)) {
        return null;
      }

      const { payload } = await jwtVerify(token, jwks, {
        algorithms: [alg],
        issuer: TELEGRAM_OIDC_ISSUER,
        audience: clientId,
        requiredClaims: ["sub", "iat", "exp"],
      });

      if (
        typeof payload.sub !== "string" ||
        typeof payload.iat !== "number" ||
        payload.iat > Math.floor(Date.now() / 1000) + 30 ||
        !payload.sub.trim() ||
        (nonce !== undefined && payload.nonce !== nonce)
      ) {
        return null;
      }
      return payload as TelegramOIDCClaims;
    } catch {
      return null;
    }
  };

  return {
    id: TELEGRAM_OIDC_PROVIDER_ID,
    // Keep the persisted OIDC subject stable across the Better Auth upgrade.
    accountSubject: ({ profile }) => profile.sub,
    issuer: TELEGRAM_OIDC_ISSUER,
    name: "Telegram",
    requiresIdTokenNonce: options.requireNonce ?? false,
    disableSignUp: options.disableSignUp,
    disableImplicitSignUp: options.disableImplicitSignUp,

    createAuthorizationURL({
      state,
      codeVerifier,
      scopes,
      redirectURI,
      idTokenNonce,
      loginHint,
      additionalParams,
    }) {
      requireOIDCCredentials();

      const _scopes = buildScopes(options);
      if (scopes) {
        _scopes.push(...scopes);
      }

      return createAuthorizationURL({
        id: TELEGRAM_OIDC_PROVIDER_ID,
        options: providerOptions,
        authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
        scopes: _scopes,
        state,
        codeVerifier,
        redirectURI,
        ...(idTokenNonce ? { nonce: idTokenNonce } : {}),
        ...(loginHint ? { loginHint } : {}),
        ...(additionalParams ? { additionalParams } : {}),
      });
    },

    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      requireOIDCCredentials();

      return validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options: providerOptions,
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
        authentication: "basic",
      });
    },

    idToken: {
      verify: async (token, nonce) =>
        (await verifyToken(token, nonce)) !== null,
    },

    async getUserInfo(token) {
      if (!token.idToken) {
        console.warn(
          "[better-auth-telegram] OIDC getUserInfo: no id_token in token response.",
          "Token keys:",
          Object.keys(token).filter((k) => k !== "raw"),
          "Raw keys:",
          token.raw ? Object.keys(token.raw) : "none"
        );
        return Promise.resolve(null);
      }

      // Better Auth's code callback calls getUserInfo directly, so verification
      // must happen here as well as on the direct ID-token sign-in path.
      const claims = await verifyToken(
        token.idToken,
        token.expectedIdTokenNonce
      );
      if (!claims) {
        return null;
      }

      const userMap = options.mapOIDCProfileToUser
        ? options.mapOIDCProfileToUser({ ...claims })
        : undefined;

      // Telegram OIDC doesn't provide email — generate a placeholder
      // so Better Auth's callback flow doesn't reject with "email_not_found".
      // Users can override via mapOIDCProfileToUser if they have a real email.
      const placeholderEmail = `${claims.sub}@telegram.oidc`;

      return Promise.resolve({
        user: {
          name: claims.name,
          image: claims.picture,
          email: placeholderEmail,
          emailVerified: false,
          ...userMap,
          // Mapping local profile fields must never redefine account identity.
          id: undefined,
        },
        data: claims,
      });
    },

    options: providerOptions,
  };
}

export { buildScopes };
