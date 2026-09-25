import { APIError, createAuthEndpoint, createAuthMiddleware, formCsrfMiddleware, getSessionFromCtx } from "better-auth/api";
import { defineErrorCodes } from "@better-auth/core/utils/error-codes";
import { getCurrentAdapter, runWithTransaction } from "@better-auth/core/context";
import { setSessionCookie } from "better-auth/cookies";
import { parseSessionOutput, parseUserOutput } from "better-auth/db";
import { authorizationCodeRequest, createAuthorizationURL, getOAuth2Tokens, validateAuthorizationCode } from "@better-auth/core/oauth2";
import { createRemoteJWKSet, customFetch, decodeProtectedHeader, jwtVerify } from "jose";
//#region src/config-endpoint.ts
/**
* Creates the GET /telegram/config endpoint.
* Always registered regardless of which flows are enabled.
*/
function createConfigEndpoint(config) {
	return { getTelegramConfig: createAuthEndpoint("/telegram/config", { method: "GET" }, async (ctx) => ctx.json({
		botUsername: config.botUsername,
		loginWidgetEnabled: config.widgetEnabled,
		miniAppEnabled: config.miniAppEnabled,
		oidcEnabled: config.oidcEnabled,
		testMode: config.testMode
	})) };
}
//#endregion
//#region src/constants.ts
const ERROR_CODES = defineErrorCodes({
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
const SUCCESS_MESSAGES = {
	TELEGRAM_LINKED: "Telegram account linked successfully",
	TELEGRAM_UNLINKED: "Telegram account unlinked successfully"
};
const PLUGIN_ID = "telegram";
const DEFAULT_MAX_AUTH_AGE = 86400;
const TELEGRAM_OIDC_PROVIDER_ID = "telegram-oidc";
const TELEGRAM_OIDC_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_OIDC_AUTH_ENDPOINT = "https://oauth.telegram.org/auth";
const TELEGRAM_OIDC_TOKEN_ENDPOINT = "https://oauth.telegram.org/token";
const TELEGRAM_OIDC_JWKS_URI = "https://oauth.telegram.org/.well-known/jwks.json";
//#endregion
//#region src/authentication.ts
function telegramAccountKey(id) {
	return {
		providerId: PLUGIN_ID,
		accountId: String(id),
		issuer: "local:oauth:telegram"
	};
}
async function validateTelegramUser(ctx, user, action, method) {
	const validate = ctx.context.options.user?.validateUserInfo;
	if (!validate) return;
	let result;
	try {
		result = await validate({
			user,
			source: {
				action,
				method
			}
		}, ctx);
	} catch {
		throw new APIError("FORBIDDEN", {
			code: "validation_failed",
			message: "User validation failed"
		});
	}
	if (result?.error) throw new APIError("FORBIDDEN", {
		code: result.error,
		message: result.errorDescription || result.error
	});
}
const telegramSessionMiddleware = createAuthMiddleware(async (ctx) => {
	ctx.context.session = null;
	const session = await getSessionFromCtx(ctx, { disableCookieCache: true });
	if (!session) throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
	const age = ctx.context.sessionConfig.freshAge;
	if (age !== 0 && Date.now() - new Date(session.session.createdAt).getTime() >= age * 1e3) throw new APIError("FORBIDDEN", {
		code: "SESSION_NOT_FRESH",
		message: "Session is not fresh"
	});
	return { session };
});
async function signInTelegram(ctx, identity, mapped, allowSignup, method) {
	const internal = ctx.context.internalAdapter;
	const key = telegramAccountKey(identity.id);
	const user = await runWithTransaction(ctx.context.adapter, async () => {
		const account = await internal.findAccountByKey(key);
		if (account) {
			const existing = await internal.findUserById(account.userId);
			if (!existing) throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_AUTHENTICATION);
			await validateTelegramUser(ctx, existing, "sign-in", method);
			return existing;
		}
		if (!allowSignup) throw APIError.from("FORBIDDEN", ERROR_CODES.USER_CREATION_DISABLED);
		if (await (await getCurrentAdapter(ctx.context.adapter)).findOne({
			model: "user",
			where: [{
				field: "telegramId",
				value: String(identity.id)
			}]
		})) throw new APIError("CONFLICT", {
			code: "TELEGRAM_EXPLICIT_LINK_REQUIRED",
			message: "Sign in to the existing account and explicitly link Telegram"
		});
		const created = await internal.createUser({
			...mapped,
			id: void 0,
			name: mapped.name || "Telegram user",
			email: mapped.email || `${identity.id}@telegram.invalid`,
			emailVerified: false,
			telegramId: String(identity.id),
			telegramUsername: identity.username
		}, { method });
		if (!created) throw APIError.from("FORBIDDEN", ERROR_CODES.USER_CREATION_DISABLED);
		const linked = await internal.createAccount({
			...key,
			userId: created.id,
			telegramId: String(identity.id),
			telegramUsername: identity.username
		});
		if (!linked || linked.userId !== created.id || linked.accountId !== key.accountId || linked.providerId !== "telegram") throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
		return created;
	});
	const session = await internal.createSession(user.id);
	if (!session || session.userId !== user.id) throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
	await setSessionCookie(ctx, {
		session,
		user
	});
	return ctx.json({
		user: parseUserOutput(ctx.context.options, user),
		session: parseSessionOutput(ctx.context.options, session)
	});
}
//#endregion
//#region src/verify.ts
const encoder = new TextEncoder();
/**
* Computes HMAC-SHA256 of data using the given key
*/
async function hmacSha256(key, data) {
	const cryptoKey = await globalThis.crypto.subtle.importKey("raw", key, {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	return globalThis.crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}
/**
* Computes SHA-256 hash of a string
*/
async function sha256(data) {
	return await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(data));
}
const hashPattern = /^[a-f0-9]{64}$/i;
const integerPattern = /^\d+$/;
function validTime(value, maxAge) {
	const now = Math.floor(Date.now() / 1e3);
	return Number.isSafeInteger(value) && value > 0 && Number.isFinite(maxAge) && maxAge > 0 && value <= now + 30 && now - value <= maxAge;
}
async function verifyHmac(key, data, hash) {
	if (!hashPattern.test(hash)) return false;
	const cryptoKey = await crypto.subtle.importKey("raw", key, {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["verify"]);
	const signature = Uint8Array.from(hash.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
	return crypto.subtle.verify("HMAC", cryptoKey, signature, encoder.encode(data));
}
/**
* Verifies the authenticity of Telegram authentication data
* @param data - Authentication data from Telegram Login Widget
* @param botToken - Bot token from @BotFather
* @param maxAge - Maximum age of auth in seconds (default: 24 hours)
* @returns Promise that resolves to true if data is valid, false otherwise
*/
async function verifyTelegramAuth(data, botToken, maxAge = DEFAULT_MAX_AUTH_AGE) {
	if (!validateTelegramAuthData(data) || !botToken) return false;
	const { hash, ...dataWithoutHash } = data;
	const authDate = dataWithoutHash.auth_date;
	if (!validTime(authDate, maxAge)) return false;
	const dataCheckString = Object.keys(dataWithoutHash).sort().map((key) => {
		return `${key}=${dataWithoutHash[key]}`;
	}).join("\n");
	return verifyHmac(new Uint8Array(await sha256(botToken)), dataCheckString, hash);
}
/**
* Validates that required fields are present in Telegram auth data
*/
function validateTelegramAuthData(data) {
	return typeof data === "object" && data !== null && Number.isSafeInteger(data.id) && data.id > 0 && typeof data.first_name === "string" && [
		data.last_name,
		data.username,
		data.photo_url
	].every((value) => value === void 0 || typeof value === "string") && Number.isSafeInteger(data.auth_date) && data.auth_date > 0 && typeof data.hash === "string";
}
/**
* Parse initData string from Telegram Mini App
* @param initData - URL-encoded initData string from Telegram.WebApp.initData
* @returns Parsed Mini App data object
*/
function parseMiniAppInitData(initData) {
	const params = new URLSearchParams(initData);
	const data = Object.create(null);
	for (const [key, value] of params.entries()) {
		if ([
			"__proto__",
			"prototype",
			"constructor"
		].includes(key)) continue;
		if (key === "user" || key === "receiver" || key === "chat") try {
			data[key] = JSON.parse(value);
		} catch {}
		else if (key === "auth_date" || key === "can_send_after") data[key] = Number(value);
		else data[key] = value;
	}
	return data;
}
/**
* Verifies the authenticity of Telegram Mini App initData
* @param initData - Raw initData string from Telegram.WebApp.initData
* @param botToken - Bot token from @BotFather
* @param maxAge - Maximum age of auth in seconds (default: 24 hours)
* @returns Promise that resolves to true if data is valid, false otherwise
*/
async function verifyMiniAppInitData(initData, botToken, maxAge = DEFAULT_MAX_AUTH_AGE) {
	if (typeof initData !== "string" || initData.length > 16384 || !botToken) return false;
	const params = new URLSearchParams(initData);
	const keys = [...params.keys()];
	if (new Set(keys).size !== keys.length) return false;
	const hash = params.get("hash");
	if (!hash) return false;
	params.delete("hash");
	const authDate = params.get("auth_date");
	if (!authDate || !integerPattern.test(authDate)) return false;
	if (!validTime(Number(authDate), maxAge)) return false;
	const dataCheckString = Array.from(params.entries()).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join("\n");
	return verifyHmac(new Uint8Array(await hmacSha256(encoder.encode("WebAppData"), botToken)), dataCheckString, hash);
}
/**
* Validates that required fields are present in Mini App data
*/
function validateMiniAppData(data) {
	return typeof data === "object" && data !== null && Number.isSafeInteger(data.auth_date) && data.auth_date > 0 && typeof data.hash === "string" && (data.user === void 0 || typeof data.user === "object" && data.user !== null && Number.isSafeInteger(data.user.id) && data.user.id > 0 && typeof data.user.first_name === "string" && [
		data.user.last_name,
		data.user.username,
		data.user.photo_url
	].every((value) => value === void 0 || typeof value === "string"));
}
//#endregion
//#region src/miniapp-endpoints.ts
/**
* Creates the Mini App endpoints: signIn, validate.
*/
function createMiniAppEndpoints(config) {
	return {
		signInWithMiniApp: createAuthEndpoint("/telegram/miniapp/signin", {
			method: "POST",
			use: [formCsrfMiddleware]
		}, async (ctx) => {
			const initData = (await ctx.body)?.initData;
			if (!initData || typeof initData !== "string") throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
			if (!config.botToken) throw APIError.from("INTERNAL_SERVER_ERROR", ERROR_CODES.BOT_TOKEN_REQUIRED);
			if (!await verifyMiniAppInitData(initData, config.botToken, config.maxAuthAge)) throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_MINI_APP_INIT_DATA);
			const data = parseMiniAppInitData(initData);
			if (!validateMiniAppData(data)) throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_MINI_APP_DATA_STRUCTURE);
			if (!data.user) throw APIError.from("BAD_REQUEST", ERROR_CODES.NO_USER_IN_INIT_DATA);
			const miniAppUser = data.user;
			const defaultUserData = {
				name: miniAppUser.last_name ? `${miniAppUser.first_name} ${miniAppUser.last_name}` : miniAppUser.first_name,
				image: miniAppUser.photo_url,
				email: void 0
			};
			return signInTelegram(ctx, miniAppUser, config.mapMiniAppDataToUser ? config.mapMiniAppDataToUser(miniAppUser) : defaultUserData, config.autoCreateUser && config.miniAppAllowAutoSignin, "telegram-miniapp");
		}),
		validateMiniApp: createAuthEndpoint("/telegram/miniapp/validate", { method: "POST" }, async (ctx) => {
			const initData = (await ctx.body)?.initData;
			if (!initData || typeof initData !== "string") throw APIError.from("BAD_REQUEST", ERROR_CODES.INIT_DATA_REQUIRED);
			if (!config.botToken) throw APIError.from("INTERNAL_SERVER_ERROR", ERROR_CODES.BOT_TOKEN_REQUIRED);
			if (!await verifyMiniAppInitData(initData, config.botToken, config.maxAuthAge)) return ctx.json({
				valid: false,
				data: null
			});
			const data = parseMiniAppInitData(initData);
			return ctx.json({
				valid: validateMiniAppData(data),
				data: validateMiniAppData(data) ? data : null
			});
		})
	};
}
/**
* Rate limit rules for Mini App endpoints.
*/
function getMiniAppRateLimits() {
	return [{
		pathMatcher: (path) => path === "/telegram/miniapp/signin",
		window: 60,
		max: 10
	}, {
		pathMatcher: (path) => path === "/telegram/miniapp/validate",
		window: 60,
		max: 20
	}];
}
//#endregion
//#region src/oidc.ts
/**
* Fetches a public key from Telegram's JWKS endpoint by key ID
*/
const SUPPORTED_SIGNING_ALGORITHMS = /* @__PURE__ */ new Set([
	"RS256",
	"ES256",
	"EdDSA"
]);
/**
* Builds the scopes array from OIDC options
*/
function buildScopes(options) {
	const scopes = /* @__PURE__ */ new Set(["openid"]);
	if (options.scopes) for (const scope of options.scopes) scopes.add(scope);
	else scopes.add("profile");
	if (options.requestPhone) scopes.add("phone");
	if (options.requestBotAccess) scopes.add("telegram:bot_access");
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
function createTelegramOIDCProvider(botToken, options = {}) {
	const botId = botToken.split(":")[0];
	const clientId = options.clientId || botId;
	const clientSecret = options.clientSecret || botToken;
	if (!(options.clientSecret || botToken)) console.warn("[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login.");
	else if (!options.clientSecret) console.warn("[better-auth-telegram] OIDC: no clientSecret provided. Using bot token as fallback.", "For OIDC to work, configure Web Login in @BotFather (Bot Settings > Web Login)", "and pass the Client Secret via oidc.clientSecret.");
	const jwksFetchTimeoutMs = options.jwksFetchTimeoutMs ?? 1e4;
	if (!Number.isFinite(jwksFetchTimeoutMs) || jwksFetchTimeoutMs <= 0) throw new Error("[better-auth-telegram] jwksFetchTimeoutMs must be a positive finite number.");
	const jwks = createRemoteJWKSet(new URL(TELEGRAM_OIDC_JWKS_URI), {
		timeoutDuration: jwksFetchTimeoutMs,
		cooldownDuration: 3e4,
		cacheMaxAge: 6e5,
		[customFetch]: (url, init) => (options.fetch ?? fetch)(url, {
			...init,
			redirect: "error"
		})
	});
	const providerOptions = {
		clientId,
		clientSecret,
		...options.disableSignUp !== void 0 ? { disableSignUp: options.disableSignUp } : {},
		...options.disableImplicitSignUp !== void 0 ? { disableImplicitSignUp: options.disableImplicitSignUp } : {},
		...options.disableIdTokenSignIn !== void 0 ? { disableIdTokenSignIn: options.disableIdTokenSignIn } : {},
		...options.requireEmailVerification !== void 0 ? { requireEmailVerification: options.requireEmailVerification } : {}
	};
	const requireOIDCCredentials = () => {
		if (!clientId) throw new Error("[better-auth-telegram] OIDC: clientId is required before starting an OIDC login.");
		if (!clientSecret) throw new Error("[better-auth-telegram] OIDC: clientSecret is required before starting an OIDC login.");
	};
	const verifyToken = async (token, nonce) => {
		try {
			const { kid, alg } = decodeProtectedHeader(token);
			if (!(kid && alg)) return null;
			if (!clientId) return null;
			if (!SUPPORTED_SIGNING_ALGORITHMS.has(alg)) return null;
			const { payload } = await jwtVerify(token, jwks, {
				algorithms: [alg],
				issuer: TELEGRAM_OIDC_ISSUER,
				audience: clientId,
				requiredClaims: [
					"sub",
					"iat",
					"exp"
				]
			});
			if (typeof payload.sub !== "string" || typeof payload.iat !== "number" || payload.iat > Math.floor(Date.now() / 1e3) + 30 || !payload.sub.trim() || nonce !== void 0 && payload.nonce !== nonce) return null;
			return payload;
		} catch {
			return null;
		}
	};
	return {
		id: TELEGRAM_OIDC_PROVIDER_ID,
		accountSubject: ({ profile }) => profile.sub,
		issuer: TELEGRAM_OIDC_ISSUER,
		name: "Telegram",
		requiresIdTokenNonce: options.requireNonce ?? false,
		disableSignUp: options.disableSignUp,
		disableImplicitSignUp: options.disableImplicitSignUp,
		createAuthorizationURL({ state, codeVerifier, scopes, redirectURI, idTokenNonce, loginHint, additionalParams }) {
			requireOIDCCredentials();
			const _scopes = buildScopes(options);
			if (scopes) _scopes.push(...scopes);
			return createAuthorizationURL({
				id: TELEGRAM_OIDC_PROVIDER_ID,
				options: providerOptions,
				authorizationEndpoint: TELEGRAM_OIDC_AUTH_ENDPOINT,
				scopes: _scopes,
				state,
				codeVerifier,
				redirectURI,
				...idTokenNonce ? { nonce: idTokenNonce } : {},
				...loginHint ? { loginHint } : {},
				...additionalParams ? { additionalParams } : {}
			});
		},
		async validateAuthorizationCode({ code, codeVerifier, redirectURI }) {
			requireOIDCCredentials();
			const request = {
				code,
				codeVerifier,
				redirectURI,
				options: providerOptions,
				tokenEndpoint: TELEGRAM_OIDC_TOKEN_ENDPOINT,
				authentication: "basic"
			};
			if (!options.fetch) return validateAuthorizationCode(request);
			const { body, headers } = await authorizationCodeRequest(request);
			const response = await options.fetch(TELEGRAM_OIDC_TOKEN_ENDPOINT, {
				method: "POST",
				body,
				headers,
				redirect: "error",
				signal: AbortSignal.timeout(1e4)
			});
			if (!response.ok || response.redirected) throw new Error(`Telegram OIDC token exchange failed (HTTP ${response.status})`);
			const data = await response.json();
			if (!data || typeof data !== "object" || Array.isArray(data) || data.error) throw new Error("Telegram OIDC token exchange returned an invalid response");
			return getOAuth2Tokens(data);
		},
		idToken: { verify: async (token, nonce) => await verifyToken(token, nonce) !== null },
		async getUserInfo(token) {
			if (!token.idToken) {
				console.warn("[better-auth-telegram] OIDC getUserInfo: no id_token in token response.", "Token keys:", Object.keys(token).filter((k) => k !== "raw"), "Raw keys:", token.raw ? Object.keys(token.raw) : "none");
				return Promise.resolve(null);
			}
			const claims = await verifyToken(token.idToken, token.expectedIdTokenNonce);
			if (!claims) return null;
			const userMap = options.mapOIDCProfileToUser ? options.mapOIDCProfileToUser({ ...claims }) : void 0;
			const placeholderEmail = `${claims.sub}@telegram.oidc`;
			return Promise.resolve({
				user: {
					name: claims.name,
					image: claims.picture,
					email: placeholderEmail,
					emailVerified: false,
					...userMap,
					id: void 0
				},
				data: claims
			});
		},
		options: providerOptions
	};
}
//#endregion
//#region src/plugin-config.ts
/**
* Parses `TelegramPluginOptions`, applies defaults, and reports credentials
* missing from enabled flows. Credential use is guarded at runtime so
* build-time environments can resolve secrets later.
*/
function createPluginConfig(options) {
	const { botToken, botUsername, allowUserToLink = true, autoCreateUser = true, loginWidget, maxAuthAge = DEFAULT_MAX_AUTH_AGE, mapTelegramDataToUser, miniApp, oidc, testMode = false } = options;
	if (!Number.isFinite(maxAuthAge) || maxAuthAge <= 0) throw new Error("maxAuthAge must be a positive finite number");
	if (miniApp?.validateInitData === false) throw new Error("Mini App signature verification cannot be disabled");
	const widgetEnabled = loginWidget !== false;
	const miniAppEnabled = miniApp?.enabled ?? false;
	const oidcEnabled = oidc?.enabled ?? false;
	const resolvedBotToken = botToken ?? "";
	const resolvedBotUsername = botUsername ?? "";
	if ((widgetEnabled || miniAppEnabled) && !resolvedBotToken) console.warn(`[better-auth-telegram] ${ERROR_CODES.BOT_TOKEN_REQUIRED.message}. The enabled HMAC flow will reject requests until it is configured.`);
	if (widgetEnabled && !resolvedBotUsername) console.warn(`[better-auth-telegram] ${ERROR_CODES.BOT_USERNAME_REQUIRED.message}. The Login Widget cannot be rendered until it is configured.`);
	if (oidcEnabled && !(oidc?.clientId || resolvedBotToken)) console.warn("[better-auth-telegram] OIDC: clientId is required. Configure oidc.clientId or botToken before starting an OIDC login.");
	if (oidcEnabled && !(oidc?.clientSecret || resolvedBotToken)) console.warn("[better-auth-telegram] OIDC: clientSecret is required. Configure oidc.clientSecret or botToken before starting an OIDC login.");
	if (testMode && oidcEnabled) console.warn("[better-auth-telegram] testMode is enabled with OIDC. Telegram's OIDC endpoint (oauth.telegram.org) has no documented test variant — OIDC authentication may not work with test server bot tokens.");
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
//#endregion
//#region src/schema.ts
/**
* Creates the conditional Telegram schema extension.
*
* Adds `telegramId`, `telegramUsername`, `telegramPhoneNumber` to the `user` table
* and `telegramId`, `telegramUsername` to the `account` table — but only when
* Login Widget or Mini App flows are enabled. OIDC-only setups skip these fields.
*/
function createTelegramSchema(config) {
	if (!(config.widgetEnabled || config.miniAppEnabled)) return;
	return {
		user: { fields: {
			telegramId: {
				type: "string",
				required: false,
				unique: true,
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
		} },
		account: { fields: {
			telegramId: {
				type: "string",
				required: false,
				unique: true,
				input: false
			},
			telegramUsername: {
				type: "string",
				required: false,
				unique: false,
				input: false
			}
		} }
	};
}
//#endregion
//#region src/widget-endpoints.ts
/**
* Creates the Login Widget endpoints: signIn, link, unlink.
*/
function createWidgetEndpoints(config) {
	return {
		signInWithTelegram: createAuthEndpoint("/telegram/signin", {
			method: "POST",
			use: [formCsrfMiddleware]
		}, async (ctx) => {
			if (!config.botToken) throw APIError.from("INTERNAL_SERVER_ERROR", ERROR_CODES.BOT_TOKEN_REQUIRED);
			const body = await ctx.body;
			if (!validateTelegramAuthData(body)) throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
			const telegramData = body;
			if (!await verifyTelegramAuth(telegramData, config.botToken, config.maxAuthAge)) throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_AUTHENTICATION);
			const defaultUserData = {
				name: telegramData.last_name ? `${telegramData.first_name} ${telegramData.last_name}` : telegramData.first_name,
				image: telegramData.photo_url,
				email: void 0
			};
			return signInTelegram(ctx, telegramData, config.mapTelegramDataToUser ? config.mapTelegramDataToUser(telegramData) : defaultUserData, config.autoCreateUser, "telegram-widget");
		}),
		linkTelegram: createAuthEndpoint("/telegram/link", {
			method: "POST",
			use: [telegramSessionMiddleware]
		}, async (ctx) => {
			if (!config.allowUserToLink || ctx.context.options.account?.accountLinking?.enabled === false) throw APIError.from("FORBIDDEN", ERROR_CODES.LINKING_DISABLED);
			const body = await ctx.body;
			const session = ctx.context.session;
			if (!session?.user?.id) throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
			if (!config.botToken) throw APIError.from("INTERNAL_SERVER_ERROR", ERROR_CODES.BOT_TOKEN_REQUIRED);
			if (!validateTelegramAuthData(body)) throw APIError.from("BAD_REQUEST", ERROR_CODES.INVALID_AUTH_DATA);
			const telegramData = body;
			if (!await verifyTelegramAuth(telegramData, config.botToken, config.maxAuthAge)) throw APIError.from("UNAUTHORIZED", ERROR_CODES.INVALID_AUTHENTICATION);
			const existingAccount = await ctx.context.adapter.findOne({
				model: "account",
				where: [{
					field: "providerId",
					value: PLUGIN_ID
				}, {
					field: "accountId",
					value: telegramData.id.toString()
				}]
			});
			if (existingAccount && existingAccount.userId !== session.user.id) throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_OTHER);
			if (existingAccount) throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF);
			if ((await ctx.context.internalAdapter.findAccounts(session.user.id)).some((account) => account.providerId === "telegram")) throw APIError.from("CONFLICT", ERROR_CODES.TELEGRAM_ALREADY_LINKED_SELF);
			await validateTelegramUser(ctx, session.user, "link-account", "telegram-widget");
			const user = await runWithTransaction(ctx.context.adapter, async () => {
				const account = await ctx.context.internalAdapter.createAccount({
					...telegramAccountKey(telegramData.id),
					userId: session.user.id,
					telegramId: String(telegramData.id),
					telegramUsername: telegramData.username
				});
				if (!account || account.userId !== session.user.id || account.accountId !== String(telegramData.id)) throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
				const updated = await ctx.context.internalAdapter.updateUser(session.user.id, {
					telegramId: String(telegramData.id),
					telegramUsername: telegramData.username
				});
				if (!updated) throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
				return updated;
			});
			await setSessionCookie(ctx, {
				session: session.session,
				user
			});
			return ctx.json({
				success: true,
				message: SUCCESS_MESSAGES.TELEGRAM_LINKED
			});
		}),
		unlinkTelegram: createAuthEndpoint("/telegram/unlink", {
			method: "POST",
			use: [telegramSessionMiddleware]
		}, async (ctx) => {
			const session = ctx.context.session;
			if (!session?.user?.id) throw APIError.from("UNAUTHORIZED", ERROR_CODES.NOT_AUTHENTICATED);
			const account = await ctx.context.adapter.findOne({
				model: "account",
				where: [{
					field: "userId",
					value: session.user.id
				}, {
					field: "providerId",
					value: PLUGIN_ID
				}]
			});
			if (!account) throw APIError.from("NOT_FOUND", ERROR_CODES.NOT_LINKED);
			if ((await ctx.context.internalAdapter.findAccounts(session.user.id)).length <= 1 && !ctx.context.options.account?.accountLinking?.allowUnlinkingAll) throw new APIError("BAD_REQUEST", {
				code: "FAILED_TO_UNLINK_LAST_ACCOUNT",
				message: "Cannot unlink the last account"
			});
			const user = await runWithTransaction(ctx.context.adapter, async () => {
				await ctx.context.internalAdapter.deleteAccount(account.id);
				if ((await ctx.context.internalAdapter.findAccounts(session.user.id)).some((item) => item.id === account.id)) throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
				const updated = await ctx.context.internalAdapter.updateUser(session.user.id, {
					telegramId: null,
					telegramUsername: null
				});
				if (!updated) throw APIError.from("FORBIDDEN", ERROR_CODES.INVALID_AUTHENTICATION);
				return updated;
			});
			await setSessionCookie(ctx, {
				session: session.session,
				user
			});
			return ctx.json({
				success: true,
				message: SUCCESS_MESSAGES.TELEGRAM_UNLINKED
			});
		})
	};
}
/**
* Rate limit rules for Login Widget endpoints.
*/
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
//#endregion
//#region src/index.ts
/**
* Telegram authentication plugin for Better Auth
*
* @example
* ```ts
* import { betterAuth } from "better-auth";
* import { telegram } from "better-auth-telegram";
*
* export const auth = betterAuth({
*   plugins: [
*     telegram({
*       botToken: process.env.TELEGRAM_BOT_TOKEN!,
*       botUsername: "your_bot_username"
*     })
*   ]
* });
* ```
*/
const telegram = (options) => {
	const config = createPluginConfig(options);
	return {
		id: PLUGIN_ID,
		...config.oidcEnabled ? { init: (ctx) => ({ context: { socialProviders: [createTelegramOIDCProvider(config.botToken, {
			...config.oidc,
			...!config.autoCreateUser ? { disableSignUp: true } : {}
		}), ...ctx.socialProviders] } }) } : {},
		schema: createTelegramSchema(config),
		endpoints: {
			...config.widgetEnabled ? createWidgetEndpoints(config) : {},
			...config.miniAppEnabled ? createMiniAppEndpoints(config) : {},
			...createConfigEndpoint(config)
		},
		$ERROR_CODES: ERROR_CODES,
		rateLimit: [...config.widgetEnabled ? getWidgetRateLimits() : [], ...config.miniAppEnabled ? getMiniAppRateLimits() : []]
	};
};
//#endregion
export { createTelegramOIDCProvider, telegram };

//# sourceMappingURL=index.js.map