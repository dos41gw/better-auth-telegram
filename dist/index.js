// src/config-endpoint.ts
import { createAuthEndpoint } from "better-auth/api";
function createConfigEndpoint(config) {
  return {
    getTelegramConfig: createAuthEndpoint(
      "/telegram/config",
      {
        method: "GET"
      },
      async (ctx) => ctx.json({
        botUsername: config.botUsername,
        loginWidgetEnabled: config.widgetEnabled,
        miniAppEnabled: config.miniAppEnabled,
        oidcEnabled: config.oidcEnabled,
        testMode: config.testMode
      })
    )
  };
}

// src/constants.ts
import { defineErrorCodes } from "@better-auth/core/utils/error-codes";
var ERROR_CODES = defineErrorCodes({
  BOT_TOKEN_REQUIRED: "Telegram plugin: botToken is required",
  BOT_USERNAME_REQUIRED: "Telegram plugin: botUsername is required",
  INVALID_AUTH_DATA: "Invalid Telegram auth data",
  INVALID_AUTHENTICATION: "Invalid Telegram authentication",
  USER_CREATION_DISABLED: "User not found and auto-create is disabled",
  NOT_AUTHENTICATED: "Not authenticated",
  LINKING_DISABLED: "Linking Telegram accounts is disabled",
  TELEGRAM_ALREADY_LINKED_OTHER: "This Telegram account is already linked to another user",
  TELEGRAM_ALREADY_LINKED_SELF: "This Telegram account is already linked to your account",
  NOT_LINKED: "No Telegram account linked",
  INIT_DATA_REQUIRED: "initData is required and must be a string",
  INVALID_MINI_APP_INIT_DATA: "Invalid Mini App initData",
  INVALID_MINI_APP_DATA_STRUCTURE: "Invalid Mini App data structure",
  NO_USER_IN_INIT_DATA: "No user data in initData",
  MINI_APP_AUTO_SIGNIN_DISABLED: "User not found and auto-signin is disabled for Mini Apps"
});
var SUCCESS_MESSAGES = {
  TELEGRAM_LINKED: "Telegram account linked successfully",
  TELEGRAM_UNLINKED: "Telegram account unlinked successfully"
};
var PLUGIN_ID = "telegram";
var DEFAULT_MAX_AUTH_AGE = 86400;
var TELEGRAM_OIDC_PROVIDER_ID = "telegram-oidc";
var TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
var TELEGRAM_OIDC_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
var TELEGRAM_OIDC_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
var TELEGRAM_OIDC_JWKS_URI = "https://oauth.telegram.org/.well-known/jwks.json";

// src/miniapp-endpoints.ts
import { APIError, createAuthEndpoint as createAuthEndpoint2 } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";

// src/account-issuer.ts
function telegramAccountIssuer(tables) {
  return tables.account?.fields.issuer ? { issuer: "local:oauth:telegram" } : {};
}

// src/verify.ts
var encoder = new TextEncoder();
async function hmacSha256(key, data) {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return globalThis.crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    encoder.encode(data)
  );
}
async function sha256(data) {
  return await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(data)
  );
}
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function verifyTelegramAuth(data, botToken, maxAge = DEFAULT_MAX_AUTH_AGE) {
  const { hash, ...dataWithoutHash } = data;
  const authDate = dataWithoutHash.auth_date;
  const currentTime = Math.floor(Date.now() / 1e3);
  if (currentTime - authDate > maxAge) {
    return false;
  }
  const dataCheckString = Object.keys(dataWithoutHash).sort().map((key) => {
    const value = dataWithoutHash[key];
    return `${key}=${value}`;
  }).join("\n");
  const secretKey = new Uint8Array(await sha256(botToken));
  const hmac = bufferToHex(await hmacSha256(secretKey, dataCheckString));
  return hmac === hash;
}
function validateTelegramAuthData(data) {
  return typeof data === "object" && data !== null && typeof data.id === "number" && typeof data.first_name === "string" && typeof data.auth_date === "number" && typeof data.hash === "string";
}
function parseMiniAppInitData(initData) {
  const params = new URLSearchParams(initData);
  const data = {};
  for (const [key, value] of params.entries()) {
    if (key === "user" || key === "receiver" || key === "chat") {
      try {
        data[key] = JSON.parse(value);
      } catch {
      }
    } else if (key === "auth_date" || key === "can_send_after") {
      data[key] = Number(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}
async function verifyMiniAppInitData(initData, botToken, maxAge = DEFAULT_MAX_AUTH_AGE) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) {
    return false;
  }
  params.delete("hash");
  const authDate = params.get("auth_date");
  if (!authDate) {
    return false;
  }
  const authDateNum = Number(authDate);
  const currentTime = Math.floor(Date.now() / 1e3);
  if (currentTime - authDateNum > maxAge) {
    return false;
  }
  const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = new Uint8Array(
    await hmacSha256(encoder.encode("WebAppData"), botToken)
  );
  const calculatedHash = bufferToHex(
    await hmacSha256(secretKey, dataCheckString)
  );
  return calculatedHash === hash;
}
function validateMiniAppData(data) {
  return typeof data === "object" && data !== null && typeof data.auth_date === "number" && typeof data.hash === "string" && (data.user === void 0 || typeof data.user === "object" && typeof data.user.id === "number" && typeof data.user.first_name === "string");
}

// src/miniapp-endpoints.ts
function createMiniAppEndpoints(config) {
  return {
    signInWithMiniApp: createAuthEndpoint2(
      "/telegram/miniapp/signin",
      {
        method: "POST"
      },
      async (ctx) => {
        const body = await ctx.body;
        const { initData } = body;
        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }
        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        if (config.miniAppValidateInitData && !await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
        )) {
          throw APIError.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_MINI_APP_INIT_DATA
          );
        }
        const data = parseMiniAppInitData(initData);
        if (!validateMiniAppData(data)) {
          throw APIError.from(
            "BAD_REQUEST",
            ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE
          );
        }
        if (!data.user) {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
        }
        const miniAppUser = data.user;
        const defaultUserData = {
          name: miniAppUser.last_name ? `${miniAppUser.first_name} ${miniAppUser.last_name}` : miniAppUser.first_name,
          image: miniAppUser.photo_url,
          email: void 0
          // Telegram doesn't provide email
        };
        const userData = config.mapMiniAppDataToUser ? config.mapMiniAppDataToUser(miniAppUser) : defaultUserData;
        const existingAccount = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "providerId",
              value: PLUGIN_ID
            },
            {
              field: "accountId",
              value: miniAppUser.id.toString()
            }
          ]
        });
        let userId;
        if (existingAccount) {
          userId = existingAccount.userId;
        } else {
          const existingUser = await ctx.context.adapter.findOne({
            model: "user",
            where: [
              {
                field: "telegramId",
                value: miniAppUser.id.toString()
              }
            ]
          });
          if (existingUser) {
            userId = existingUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                ...telegramAccountIssuer(ctx.context.tables ?? {}),
                userId,
                providerId: PLUGIN_ID,
                accountId: miniAppUser.id.toString(),
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
          } else if (config.autoCreateUser && config.miniAppAllowAutoSignin) {
            const newUser = await ctx.context.adapter.create({
              model: "user",
              data: {
                ...userData,
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
            userId = newUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                ...telegramAccountIssuer(ctx.context.tables ?? {}),
                userId: newUser.id,
                providerId: PLUGIN_ID,
                accountId: miniAppUser.id.toString(),
                telegramId: miniAppUser.id.toString(),
                telegramUsername: miniAppUser.username
              }
            });
          } else {
            throw APIError.from(
              "NOT_FOUND",
              ERROR_CODES.MINI_APP_AUTO_SIGNIN_DISABLED
            );
          }
        }
        const session = await ctx.context.internalAdapter.createSession(userId);
        const user = await ctx.context.adapter.findOne({
          model: "user",
          where: [{ field: "id", value: userId }]
        });
        await setSessionCookie(ctx, {
          session,
          user
        });
        return ctx.json({
          session,
          user
        });
      }
    ),
    validateMiniApp: createAuthEndpoint2(
      "/telegram/miniapp/validate",
      {
        method: "POST"
      },
      async (ctx) => {
        const body = await ctx.body;
        const { initData } = body;
        if (!initData || typeof initData !== "string") {
          throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
        }
        if (!config.botToken) {
          throw APIError.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        const isValid = await verifyMiniAppInitData(
          initData,
          config.botToken,
          config.maxAuthAge
        );
        if (!isValid) {
          return ctx.json({
            valid: false,
            data: null
          });
        }
        const data = parseMiniAppInitData(initData);
        return ctx.json({
          valid: true,
          data
        });
      }
    )
  };
}
function getMiniAppRateLimits() {
  return [
    {
      pathMatcher: (path) => path === "/telegram/miniapp/signin",
      window: 60,
      max: 10
    },
    {
      pathMatcher: (path) => path === "/telegram/miniapp/validate",
      window: 60,
      max: 20
    }
  ];
}

// src/oidc.ts
import {
  createAuthorizationURL,
  validateAuthorizationCode
} from "@better-auth/core/oauth2";
import { betterFetch } from "@better-fetch/fetch";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
var SUPPORTED_SIGNING_ALGORITHMS = /* @__PURE__ */ new Set(["RS256", "ES256", "EdDSA"]);
var getTelegramPublicKey = async (kid, algorithm, timeout) => {
  const { data } = await betterFetch(TELEGRAM_OIDC_JWKS_URI, { timeout, retry: 0 });
  if (!data?.keys) {
    throw new Error("Failed to fetch Telegram JWKS");
  }
  const jwk = data.keys.find((key) => key.kid === kid && key.alg === algorithm);
  if (!jwk) {
    throw new Error(`JWK with kid ${kid} and algorithm ${algorithm} not found`);
  }
  return await importJWK(jwk, algorithm);
};
function buildScopes(options) {
  const scopes = /* @__PURE__ */ new Set(["openid"]);
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
function createTelegramOIDCProvider(botToken, options = {}) {
  const botId = botToken.split(":")[0];
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
  const jwksFetchTimeoutMs = options.jwksFetchTimeoutMs ?? 1e4;
  if (!Number.isFinite(jwksFetchTimeoutMs) || jwksFetchTimeoutMs <= 0) {
    throw new Error(
      "[better-auth-telegram] jwksFetchTimeoutMs must be a positive finite number."
    );
  }
  const providerOptions = {
    clientId,
    clientSecret
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
  const verifyToken = async (token, nonce) => {
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
      const publicKey = await getTelegramPublicKey(
        kid,
        alg,
        jwksFetchTimeoutMs
      );
      const { payload } = await jwtVerify(token, publicKey, {
        algorithms: [alg],
        issuer: TELEGRAM_OIDC_ISSUER,
        audience: clientId,
        requiredClaims: ["sub", "iat", "exp"]
      });
      if (typeof payload.sub !== "string" || !payload.sub.trim() || nonce !== void 0 && payload.nonce !== nonce) {
        return null;
      }
      return payload;
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
    createAuthorizationURL({ state, codeVerifier, scopes, redirectURI }) {
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
        redirectURI
      });
    },
    validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
      requireOIDCCredentials();
      return validateAuthorizationCode({
        code,
        codeVerifier,
        redirectURI,
        options: providerOptions,
        tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT
      });
    },
    idToken: {
      verify: async (token, nonce) => await verifyToken(token, nonce) !== null
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
      const claims = await verifyToken(
        token.idToken,
        token.expectedIdTokenNonce
      );
      if (!claims) {
        return null;
      }
      const userMap = options.mapOIDCProfileToUser ? options.mapOIDCProfileToUser({ ...claims }) : void 0;
      const placeholderEmail = `${claims.sub}@telegram.oidc`;
      return Promise.resolve({
        user: {
          name: claims.name,
          image: claims.picture,
          email: placeholderEmail,
          emailVerified: false,
          ...userMap,
          // Mapping local profile fields must never redefine account identity.
          id: void 0
        },
        data: claims
      });
    },
    options: providerOptions
  };
}

// src/plugin-config.ts
function createPluginConfig(options) {
  const {
    botToken,
    botUsername,
    allowUserToLink = true,
    autoCreateUser = true,
    loginWidget,
    maxAuthAge = DEFAULT_MAX_AUTH_AGE,
    mapTelegramDataToUser,
    miniApp,
    oidc,
    testMode = false
  } = options;
  const widgetEnabled = loginWidget !== false;
  const miniAppEnabled = miniApp?.enabled ?? false;
  const oidcEnabled = oidc?.enabled ?? false;
  const resolvedBotToken = botToken ?? "";
  const resolvedBotUsername = botUsername ?? "";
  if ((widgetEnabled || miniAppEnabled) && !resolvedBotToken) {
    console.warn(
      `[better-auth-telegram] ${ERROR_CODES.BOT_TOKEN_REQUIRED.message}. The enabled HMAC flow will reject requests until it is configured.`
    );
  }
  if (widgetEnabled && !resolvedBotUsername) {
    console.warn(
      `[better-auth-telegram] ${ERROR_CODES.BOT_USERNAME_REQUIRED.message}. The Login Widget cannot be rendered until it is configured.`
    );
  }
  if (oidcEnabled && !(oidc?.clientId || resolvedBotToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientId is required. Configure oidc.clientId or botToken before starting an OIDC login."
    );
  }
  if (oidcEnabled && !(oidc?.clientSecret || resolvedBotToken)) {
    console.warn(
      "[better-auth-telegram] OIDC: clientSecret is required. Configure oidc.clientSecret or botToken before starting an OIDC login."
    );
  }
  if (testMode && oidcEnabled) {
    console.warn(
      "[better-auth-telegram] testMode is enabled with OIDC. Telegram's OIDC endpoint (oauth.telegram.org) has no documented test variant \u2014 OIDC authentication may not work with test server bot tokens."
    );
  }
  return {
    botToken: resolvedBotToken,
    botUsername: resolvedBotUsername,
    widgetEnabled,
    miniAppEnabled,
    oidcEnabled,
    testMode,
    allowUserToLink,
    autoCreateUser,
    maxAuthAge,
    miniAppValidateInitData: miniApp?.validateInitData ?? true,
    miniAppAllowAutoSignin: miniApp?.allowAutoSignin ?? true,
    mapTelegramDataToUser,
    mapMiniAppDataToUser: miniApp?.mapMiniAppDataToUser,
    oidc
  };
}

// src/schema.ts
function createTelegramSchema(config) {
  if (!(config.widgetEnabled || config.miniAppEnabled)) {
    return void 0;
  }
  return {
    user: {
      fields: {
        telegramId: {
          type: "string",
          required: false,
          unique: false,
          input: false
        },
        telegramPhoneNumber: {
          type: "string",
          required: false,
          unique: false,
          input: false
        },
        telegramUsername: {
          type: "string",
          required: false,
          unique: false,
          input: false
        }
      }
    },
    account: {
      fields: {
        telegramId: {
          type: "string",
          required: false,
          unique: false
        },
        telegramUsername: {
          type: "string",
          required: false,
          unique: false
        }
      }
    }
  };
}

// src/widget-endpoints.ts
import {
  APIError as APIError2,
  createAuthEndpoint as createAuthEndpoint3,
  sessionMiddleware
} from "better-auth/api";
import { setSessionCookie as setSessionCookie2 } from "better-auth/cookies";
function createWidgetEndpoints(config) {
  return {
    signInWithTelegram: createAuthEndpoint3(
      "/telegram/signin",
      {
        method: "POST"
      },
      async (ctx) => {
        if (!config.botToken) {
          throw APIError2.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        const body = await ctx.body;
        if (!validateTelegramAuthData(body)) {
          throw APIError2.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
        }
        const telegramData = body;
        const isValid = await verifyTelegramAuth(
          telegramData,
          config.botToken,
          config.maxAuthAge
        );
        if (!isValid) {
          throw APIError2.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_AUTHENTICATION
          );
        }
        const defaultUserData = {
          name: telegramData.last_name ? `${telegramData.first_name} ${telegramData.last_name}` : telegramData.first_name,
          image: telegramData.photo_url,
          email: void 0
          // Telegram doesn't provide email
        };
        const userData = config.mapTelegramDataToUser ? config.mapTelegramDataToUser(telegramData) : defaultUserData;
        const existingAccount = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "providerId",
              value: PLUGIN_ID
            },
            {
              field: "accountId",
              value: telegramData.id.toString()
            }
          ]
        });
        let userId;
        if (existingAccount) {
          userId = existingAccount.userId;
        } else {
          const existingUser = await ctx.context.adapter.findOne({
            model: "user",
            where: [
              {
                field: "telegramId",
                value: telegramData.id.toString()
              }
            ]
          });
          if (existingUser) {
            userId = existingUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                ...telegramAccountIssuer(ctx.context.tables ?? {}),
                userId,
                providerId: PLUGIN_ID,
                accountId: telegramData.id.toString(),
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username
              }
            });
          } else if (config.autoCreateUser) {
            const newUser = await ctx.context.adapter.create({
              model: "user",
              data: {
                ...userData,
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username
              }
            });
            userId = newUser.id;
            await ctx.context.adapter.create({
              model: "account",
              data: {
                ...telegramAccountIssuer(ctx.context.tables ?? {}),
                userId: newUser.id,
                providerId: PLUGIN_ID,
                accountId: telegramData.id.toString(),
                telegramId: telegramData.id.toString(),
                telegramUsername: telegramData.username
              }
            });
          } else {
            throw APIError2.from(
              "NOT_FOUND",
              ERROR_CODES.USER_CREATION_DISABLED
            );
          }
        }
        const session = await ctx.context.internalAdapter.createSession(userId);
        const user = await ctx.context.adapter.findOne({
          model: "user",
          where: [{ field: "id", value: userId }]
        });
        await setSessionCookie2(ctx, {
          session,
          user
        });
        return ctx.json({
          user,
          session
        });
      }
    ),
    linkTelegram: createAuthEndpoint3(
      "/telegram/link",
      {
        method: "POST",
        use: [sessionMiddleware]
      },
      async (ctx) => {
        if (!config.allowUserToLink) {
          throw APIError2.from("FORBIDDEN", ERROR_CODES.LINKING_DISABLED);
        }
        const body = await ctx.body;
        const session = ctx.context.session;
        if (!session?.user?.id) {
          throw APIError2.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
        }
        if (!config.botToken) {
          throw APIError2.from(
            "INTERNAL_SERVER_ERROR",
            ERROR_CODES.BOT_TOKEN_REQUIRED
          );
        }
        if (!validateTelegramAuthData(body)) {
          throw APIError2.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
        }
        const telegramData = body;
        const isValid = await verifyTelegramAuth(
          telegramData,
          config.botToken,
          config.maxAuthAge
        );
        if (!isValid) {
          throw APIError2.from(
            "UNAUTHORIZED",
            ERROR_CODES.INVALID_AUTHENTICATION
          );
        }
        const existingAccount = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "providerId",
              value: PLUGIN_ID
            },
            {
              field: "accountId",
              value: telegramData.id.toString()
            }
          ]
        });
        if (existingAccount && existingAccount.userId !== session.user.id) {
          throw APIError2.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER
          );
        }
        if (existingAccount) {
          throw APIError2.from(
            "CONFLICT",
            ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF
          );
        }
        await ctx.context.adapter.create({
          model: "account",
          data: {
            ...telegramAccountIssuer(ctx.context.tables ?? {}),
            userId: session.user.id,
            providerId: PLUGIN_ID,
            accountId: telegramData.id.toString(),
            telegramId: telegramData.id.toString(),
            telegramUsername: telegramData.username
          }
        });
        await ctx.context.adapter.update({
          model: "user",
          where: [{ field: "id", value: session.user.id }],
          update: {
            telegramId: telegramData.id.toString(),
            telegramUsername: telegramData.username
          }
        });
        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_LINKED
        });
      }
    ),
    unlinkTelegram: createAuthEndpoint3(
      "/telegram/unlink",
      {
        method: "POST",
        use: [sessionMiddleware]
      },
      async (ctx) => {
        const session = ctx.context.session;
        if (!session?.user?.id) {
          throw APIError2.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
        }
        const account = await ctx.context.adapter.findOne({
          model: "account",
          where: [
            {
              field: "userId",
              value: session.user.id
            },
            {
              field: "providerId",
              value: PLUGIN_ID
            }
          ]
        });
        if (!account) {
          throw APIError2.from("NOT_FOUND", ERROR_CODES.NOT_LINKED);
        }
        await ctx.context.adapter.delete({
          model: "account",
          where: [
            {
              field: "id",
              value: account.id
            }
          ]
        });
        await ctx.context.adapter.update({
          model: "user",
          where: [{ field: "id", value: session.user.id }],
          update: {
            telegramId: null,
            telegramUsername: null
          }
        });
        return ctx.json({
          success: true,
          message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED
        });
      }
    )
  };
}
function getWidgetRateLimits() {
  return [
    {
      pathMatcher: (path) => path === "/telegram/signin",
      window: 60,
      max: 10
    },
    {
      pathMatcher: (path) => path === "/telegram/link",
      window: 60,
      max: 5
    },
    {
      pathMatcher: (path) => path === "/telegram/unlink",
      window: 60,
      max: 5
    }
  ];
}

// src/index.ts
var telegram = (options) => {
  const config = createPluginConfig(options);
  return {
    id: PLUGIN_ID,
    // Inject OIDC provider into better-auth's social providers
    ...config.oidcEnabled ? {
      init: (ctx) => ({
        context: {
          socialProviders: [
            createTelegramOIDCProvider(config.botToken, config.oidc),
            ...ctx.socialProviders
          ]
        }
      })
    } : {},
    schema: createTelegramSchema(config),
    endpoints: {
      ...config.widgetEnabled ? createWidgetEndpoints(config) : {},
      ...config.miniAppEnabled ? createMiniAppEndpoints(config) : {},
      ...createConfigEndpoint(config)
    },
    $ERROR_CODES: ERROR_CODES,
    rateLimit: [
      ...config.widgetEnabled ? getWidgetRateLimits() : [],
      ...config.miniAppEnabled ? getMiniAppRateLimits() : []
    ]
  };
};
export {
  createTelegramOIDCProvider,
  telegram
};
//# sourceMappingURL=index.js.map