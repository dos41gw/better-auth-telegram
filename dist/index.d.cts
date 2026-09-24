import * as better_call from 'better-call';
import * as better_auth from 'better-auth';
import { OAuthProvider } from '@better-auth/core/oauth2';

/**
 * Data returned by Telegram Login Widget
 */
interface TelegramAuthData {
    auth_date: number;
    first_name: string;
    hash: string;
    id: number;
    last_name?: string;
    photo_url?: string;
    username?: string;
}
/**
 * User object from Telegram Mini Apps
 */
interface TelegramMiniAppUser {
    allows_write_to_pm?: boolean;
    first_name: string;
    id: number;
    is_bot?: boolean;
    is_premium?: boolean;
    language_code?: string;
    last_name?: string;
    photo_url?: string;
    username?: string;
}
/**
 * Chat object from Telegram Mini Apps
 */
interface TelegramMiniAppChat {
    id: number;
    photo_url?: string;
    title?: string;
    type: string;
    username?: string;
}
/**
 * Complete data from Telegram Mini Apps initData
 */
interface TelegramMiniAppData {
    auth_date: number;
    can_send_after?: number;
    chat?: TelegramMiniAppChat;
    chat_instance?: string;
    chat_type?: "sender" | "private" | "group" | "supergroup" | "channel";
    hash: string;
    query_id?: string;
    receiver?: TelegramMiniAppUser;
    start_param?: string;
    user?: TelegramMiniAppUser;
}
/**
 * JWT ID token claims from Telegram OIDC
 */
interface TelegramOIDCClaims {
    aud: string;
    exp: number;
    family_name?: string;
    given_name?: string;
    iat: number;
    id?: number;
    iss: string;
    name?: string;
    phone_number?: string;
    phone_number_verified?: boolean;
    picture?: string;
    preferred_username?: string;
    sub: string;
}
/**
 * Configuration options for Telegram OIDC authentication
 */
interface TelegramOIDCOptions {
    /**
     * Client ID from @BotFather's Web Login settings.
     * If omitted, extracted from the main botToken (first part before colon).
     * Use this when your OIDC bot is different from your Login Widget bot.
     */
    clientId?: string;
    /**
     * Client Secret from @BotFather's Web Login settings.
     * This is NOT your bot token — BotFather provides a separate secret
     * when you configure Web Login under Bot Settings > Web Login.
     *
     * If omitted, falls back to the bot token (deprecated behavior that
     * won't work with Telegram's official OIDC registration).
     */
    clientSecret?: string;
    /**
     * Enable Telegram OIDC support
     * @default false
     */
    enabled?: boolean;
    /** Timeout for fetching Telegram signing keys, in milliseconds. @default 10000 */
    jwksFetchTimeoutMs?: number;
    /**
     * Custom function to map OIDC claims to user object
     */
    mapOIDCProfileToUser?: (claims: TelegramOIDCClaims) => {
        /** Account identity always comes from the verified OIDC sub claim. */
        id?: never;
        name?: string;
        email?: string;
        image?: string;
        [key: string]: any;
    };
    /**
     * Request bot access (adds "telegram:bot_access" scope)
     * @default false
     */
    requestBotAccess?: boolean;
    /**
     * Request phone number (adds "phone" scope)
     * @default false
     */
    requestPhone?: boolean;
    /**
     * Additional scopes beyond "openid"
     * @default ["profile"]
     */
    scopes?: string[];
}
/**
 * Configuration options for the Telegram plugin
 */
interface TelegramPluginOptions {
    /**
     * Allow users to link their Telegram account to existing account
     * @default true
     */
    allowUserToLink?: boolean;
    /**
     * Automatically create user if doesn't exist
     * @default true
     */
    autoCreateUser?: boolean;
    /**
     * Bot token obtained from @BotFather
     * Used for verifying authentication data
     */
    botToken?: string;
    /**
     * Bot username (without @)
     * Used for generating the login widget
     */
    botUsername?: string;
    /**
     * Enable Login Widget endpoints (signin, link, unlink).
     * When false, Widget endpoints are not registered and Telegram-specific
     * user/account schema fields are omitted (unless Mini App is enabled).
     * @default true
     */
    loginWidget?: boolean;
    /**
     * Custom function to map Telegram data to user object
     */
    mapTelegramDataToUser?: (data: TelegramAuthData) => {
        name?: string;
        email?: string;
        image?: string;
        [key: string]: any;
    };
    /**
     * Maximum age of auth_date in seconds
     * Prevents replay attacks
     * @default 86400 (24 hours)
     */
    maxAuthAge?: number;
    /**
     * Telegram Mini Apps configuration
     */
    miniApp?: {
        /**
         * Enable Telegram Mini Apps support
         * @default false
         */
        enabled?: boolean;
        /**
         * Validate initData from Mini Apps
         * @default true
         */
        validateInitData?: boolean;
        /**
         * Allow automatic sign-in from Mini Apps
         * @default true
         */
        allowAutoSignin?: boolean;
        /**
         * Custom function to map Mini App user data to user object
         */
        mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
            name?: string;
            email?: string;
            image?: string;
            [key: string]: any;
        };
    };
    /**
     * Telegram OIDC (OpenID Connect) configuration
     * Uses standard OAuth 2.0 Authorization Code flow with PKCE
     * via oauth.telegram.org
     */
    oidc?: TelegramOIDCOptions;
    /**
     * Enable Telegram test server mode.
     * When enabled, the client widget will use Telegram's test environment.
     * HMAC verification works identically — only the bot token differs.
     * Note: OIDC (oauth.telegram.org) has no documented test variant;
     * a warning is logged if both testMode and oidc are enabled.
     * @default false
     */
    testMode?: boolean;
}
/**
 * Account record as returned by the Better Auth adapter
 */
interface TelegramAccountRecord {
    accountId: string;
    id: string;
    providerId: string;
    telegramId?: string;
    telegramUsername?: string;
    userId: string;
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
declare function createTelegramOIDCProvider(botToken: string, options?: TelegramOIDCOptions): OAuthProvider<TelegramOIDCClaims>;

/**
 * Resolved configuration for the Telegram plugin.
 * Created from `TelegramPluginOptions` with all defaults applied.
 */
interface TelegramPluginConfig {
    allowUserToLink: boolean;
    autoCreateUser: boolean;
    botToken: string;
    botUsername: string;
    mapMiniAppDataToUser?: (data: TelegramMiniAppUser) => {
        name?: string;
        email?: string;
        image?: string;
        [key: string]: any;
    };
    mapTelegramDataToUser?: (data: TelegramAuthData) => {
        name?: string;
        email?: string;
        image?: string;
        [key: string]: any;
    };
    maxAuthAge: number;
    miniAppAllowAutoSignin: boolean;
    miniAppEnabled: boolean;
    miniAppValidateInitData: boolean;
    oidc?: TelegramOIDCOptions;
    oidcEnabled: boolean;
    testMode: boolean;
    widgetEnabled: boolean;
}

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
declare const telegram: (options: TelegramPluginOptions) => {
    schema: better_auth.BetterAuthPluginDBSchema | undefined;
    endpoints: {
        getTelegramConfig: better_call.StrictEndpoint<"/telegram/config", {
            method: "GET";
        }, {
            botUsername: string;
            loginWidgetEnabled: boolean;
            miniAppEnabled: boolean;
            oidcEnabled: boolean;
            testMode: boolean;
        }>;
        signInWithMiniApp?: better_call.StrictEndpoint<"/telegram/miniapp/signin", {
            method: "POST";
        }, {
            session: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string | null | undefined;
                userAgent?: string | null | undefined;
            };
            user: unknown;
        }> | undefined;
        validateMiniApp?: better_call.StrictEndpoint<"/telegram/miniapp/validate", {
            method: "POST";
        }, {
            valid: boolean;
            data: null;
        } | {
            valid: boolean;
            data: TelegramMiniAppData;
        }> | undefined;
        signInWithTelegram?: better_call.StrictEndpoint<"/telegram/signin", {
            method: "POST";
        }, {
            user: unknown;
            session: {
                id: string;
                createdAt: Date;
                updatedAt: Date;
                userId: string;
                expiresAt: Date;
                token: string;
                ipAddress?: string | null | undefined;
                userAgent?: string | null | undefined;
            };
        }> | undefined;
        linkTelegram?: better_call.StrictEndpoint<"/telegram/link", {
            method: "POST";
            use: better_call.Middleware<better_call.MiddlewareOptions, (inputContext: better_call.MiddlewareInputContext<better_call.MiddlewareOptions>) => Promise<{
                session: {
                    session: Record<string, any> & {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        userId: string;
                        expiresAt: Date;
                        token: string;
                        ipAddress?: string | null | undefined;
                        userAgent?: string | null | undefined;
                    };
                    user: Record<string, any> & {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        email: string;
                        emailVerified: boolean;
                        name: string;
                        image?: string | null | undefined;
                    };
                };
            }>>[];
        }, {
            success: boolean;
            message: "Telegram account linked successfully";
        }> | undefined;
        unlinkTelegram?: better_call.StrictEndpoint<"/telegram/unlink", {
            method: "POST";
            use: better_call.Middleware<better_call.MiddlewareOptions, (inputContext: better_call.MiddlewareInputContext<better_call.MiddlewareOptions>) => Promise<{
                session: {
                    session: Record<string, any> & {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        userId: string;
                        expiresAt: Date;
                        token: string;
                        ipAddress?: string | null | undefined;
                        userAgent?: string | null | undefined;
                    };
                    user: Record<string, any> & {
                        id: string;
                        createdAt: Date;
                        updatedAt: Date;
                        email: string;
                        emailVerified: boolean;
                        name: string;
                        image?: string | null | undefined;
                    };
                };
            }>>[];
        }, {
            success: boolean;
            message: "Telegram account unlinked successfully";
        }> | undefined;
    };
    $ERROR_CODES: {
        BOT_TOKEN_REQUIRED: better_auth.RawError<"BOT_TOKEN_REQUIRED">;
        BOT_USERNAME_REQUIRED: better_auth.RawError<"BOT_USERNAME_REQUIRED">;
        INVALID_AUTH_DATA: better_auth.RawError<"INVALID_AUTH_DATA">;
        INVALID_AUTHENTICATION: better_auth.RawError<"INVALID_AUTHENTICATION">;
        USER_CREATION_DISABLED: better_auth.RawError<"USER_CREATION_DISABLED">;
        NOT_AUTHENTICATED: better_auth.RawError<"NOT_AUTHENTICATED">;
        LINKING_DISABLED: better_auth.RawError<"LINKING_DISABLED">;
        TELEGRAM_ALREADY_LINKED_OTHER: better_auth.RawError<"TELEGRAM_ALREADY_LINKED_OTHER">;
        TELEGRAM_ALREADY_LINKED_SELF: better_auth.RawError<"TELEGRAM_ALREADY_LINKED_SELF">;
        NOT_LINKED: better_auth.RawError<"NOT_LINKED">;
        INIT_DATA_REQUIRED: better_auth.RawError<"INIT_DATA_REQUIRED">;
        INVALID_MINI_APP_INIT_DATA: better_auth.RawError<"INVALID_MINI_APP_INIT_DATA">;
        INVALID_MINI_APP_DATA_STRUCTURE: better_auth.RawError<"INVALID_MINI_APP_DATA_STRUCTURE">;
        NO_USER_IN_INIT_DATA: better_auth.RawError<"NO_USER_IN_INIT_DATA">;
        MINI_APP_AUTO_SIGNIN_DISABLED: better_auth.RawError<"MINI_APP_AUTO_SIGNIN_DISABLED">;
    };
    rateLimit: ({
        pathMatcher: (path: string) => path is "/telegram/signin";
        window: number;
        max: number;
    } | {
        pathMatcher: (path: string) => path is "/telegram/link";
        window: number;
        max: number;
    } | {
        pathMatcher: (path: string) => path is "/telegram/unlink";
        window: number;
        max: number;
    } | {
        pathMatcher: (path: string) => path is "/telegram/miniapp/signin";
        window: number;
        max: number;
    } | {
        pathMatcher: (path: string) => path is "/telegram/miniapp/validate";
        window: number;
        max: number;
    })[];
    init?: ((ctx: better_auth.AuthContext) => {
        context: {
            socialProviders: better_auth.OAuthProvider<object, Partial<better_auth.ProviderOptions<object>>>[];
        };
    }) | undefined;
    id: "telegram";
};
declare module "@better-auth/core" {
    interface BetterAuthPluginRegistry<AuthOptions, Options> {
        telegram: {
            creator: typeof telegram;
        };
    }
}

export { type TelegramAccountRecord, type TelegramAuthData, type TelegramMiniAppChat, type TelegramMiniAppData, type TelegramMiniAppUser, type TelegramOIDCClaims, type TelegramOIDCOptions, type TelegramPluginConfig, type TelegramPluginOptions, createTelegramOIDCProvider, telegram };
