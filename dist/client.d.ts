import { a as TelegramAuthData, t as telegram } from "./index-DkeUfrc3.js";
import { BetterAuthClientPlugin } from "better-auth/client";
//#region src/client.d.ts
type TelegramPlugin = typeof telegram;
/**
 * Options that can be passed to fetch calls for customization
 * (e.g., custom headers, cache control, credentials)
 */
type FetchOptions = Record<string, any>;
interface TelegramConfigResponse {
  botUsername: string;
  loginWidgetEnabled: boolean;
  miniAppEnabled: boolean;
  oidcEnabled: boolean;
  testMode: boolean;
}
/**
 * Options for initializing Telegram Login Widget
 */
export interface TelegramWidgetOptions {
  /**
   * Corner radius of the button
   * @default 20
   */
  cornerRadius?: number;
  /**
   * Language code (e.g., "en", "pl")
   */
  lang?: string;
  /**
   * Request write access permission
   * @default false
   */
  requestAccess?: boolean;
  /**
   * Whether to show user photo
   * @default true
   */
  showUserPhoto?: boolean;
  /**
   * Size of the login button
   * @default "large"
   */
  size?: "large" | "medium" | "small";
}
/**
 * Client plugin for Telegram authentication
 */
export declare const telegramClient: () => {
  id: "telegram";
  $InferServerPlugin: ReturnType<TelegramPlugin>;
  atomListeners: {
    matcher: (path: string) => boolean;
    signal: "$sessionSignal";
  }[];
  getActions: (baseFetch: import("@better-fetch/fetch").BetterFetch, $store?: Parameters<NonNullable<BetterAuthClientPlugin["getActions"]>>[1]) => {
    /**
     * Sign in with Telegram
     * @param authData - Authentication data from Telegram Login Widget
     * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
     */
    signInWithTelegram: (authData: TelegramAuthData, fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Link current user account with Telegram
     * @param authData - Authentication data from Telegram Login Widget
     * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
     */
    linkTelegram: (authData: TelegramAuthData, fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Unlink Telegram account from current user
     * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
     */
    unlinkTelegram: (fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Get Telegram bot configuration
     * @param fetchOptions - Optional fetch options (e.g., custom headers, cache control)
     */
    getTelegramConfig: (fetchOptions?: FetchOptions) => Promise<{
      data: TelegramConfigResponse;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Initialize Telegram Login Widget
     * This function creates a Telegram login button and handles the authentication flow
     *
     * @param containerId - ID of the container element where the widget will be rendered
     * @param options - Widget configuration options
     * @param onAuth - Callback function called when user successfully authenticates
     *
     * @example
     * ```ts
     * await initTelegramWidget("telegram-login-container", {
     *   size: "large",
     *   showUserPhoto: true
     * }, async (authData) => {
     *   const result = await signInWithTelegram(authData);
     *   console.log("Signed in:", result);
     * });
     * ```
     */
    initTelegramWidget: (containerId: string, options: TelegramWidgetOptions | undefined, onAuth: (authData: TelegramAuthData) => void | Promise<void>) => Promise<void>;
    /**
     * Alternative method: Use Telegram Login with redirect
     *
     * @param redirectUrl - URL to redirect after successful authentication
     * @param options - Widget configuration options
     *
     * @example
     * ```ts
     * await initTelegramWidgetRedirect(
     *   "/auth/telegram/callback",
     *   { size: "medium" }
     * );
     * ```
     */
    initTelegramWidgetRedirect: (containerId: string, redirectUrl: string, options?: TelegramWidgetOptions) => Promise<void>;
    /**
     * Sign in with Telegram Mini App
     * @param initData - Raw initData string from Telegram.WebApp.initData
     *
     * @example
     * ```ts
     * // Inside a Telegram Mini App
     * const initData = window.Telegram.WebApp.initData;
     * const result = await signInWithMiniApp(initData);
     * console.log("Signed in:", result);
     * ```
     */
    signInWithMiniApp: (initData: string, fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Validate Telegram Mini App initData
     * @param initData - Raw initData string from Telegram.WebApp.initData
     * @returns Object with valid status and parsed data if valid
     *
     * @example
     * ```ts
     * const initData = window.Telegram.WebApp.initData;
     * const result = await validateMiniApp(initData);
     * if (result.data?.valid) {
     *   console.log("User:", result.data.data?.user);
     * }
     * ```
     */
    validateMiniApp: (initData: string, fetchOptions?: FetchOptions) => Promise<{
      data: {
        valid: boolean;
        data: any;
      };
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Auto sign-in from Telegram Mini App
     * Automatically retrieves initData from Telegram.WebApp and signs in
     * Only works when running inside a Telegram Mini App
     *
     * @example
     * ```ts
     * // Auto-signin when Mini App launches
     * try {
     *   const result = await autoSignInFromMiniApp();
     *   console.log("Auto signed in:", result);
     * } catch (error) {
     *   console.error("Not running in Mini App or auth failed");
     * }
     * ```
     */
    autoSignInFromMiniApp: (fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
    /**
     * Sign in with Telegram OIDC (OpenID Connect)
     * Initiates the standard OAuth 2.0 Authorization Code flow with PKCE
     * via oauth.telegram.org. Requires `oidc.enabled: true` on the server.
     *
     * @param options - Callback URLs for redirect after authentication
     * @param fetchOptions - Optional fetch options
     *
     * @example
     * ```ts
     * await authClient.signInWithTelegramOIDC({
     *   callbackURL: "/dashboard",
     * });
     * ```
     */
    signInWithTelegramOIDC: (options?: {
      callbackURL?: string;
      errorCallbackURL?: string;
      newUserCallbackURL?: string;
      disableRedirect?: boolean;
      requestSignUp?: boolean;
      scopes?: string[];
      loginHint?: string;
      additionalParams?: Record<string, string>;
      additionalData?: Record<string, unknown>;
      idToken?: {
        token: string;
        nonce?: string;
        accessToken?: string;
        refreshToken?: string;
        expiresAt?: number;
      };
    }, fetchOptions?: FetchOptions) => Promise<{
      data: unknown;
      error: null;
    } | {
      data: null;
      error: {
        message?: string;
        status: number;
        statusText: string;
      };
    }>;
  };
};
//#endregion
export { telegramClient as default };
//# sourceMappingURL=client.d.ts.map